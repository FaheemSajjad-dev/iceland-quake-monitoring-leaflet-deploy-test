import requests
from bs4 import BeautifulSoup
from datetime import datetime, timezone
import logging
import re
import os
import sqlite3

CURRENT_FILE_PATH = os.path.dirname(os.path.abspath(__file__))
DB_DIR = os.path.join(CURRENT_FILE_PATH, "data")
os.makedirs(DB_DIR, exist_ok=True)
DB_PATH = os.path.join(DB_DIR, "earthquakes.db")

try:
    from app import app, db, Earthquake
    USING_FLASK = True
except (ImportError, ModuleNotFoundError):
    USING_FLASK = False
    print("Running in standalone mode without Flask app context.")

BASE_URL = 'http://hraun.vedur.is/ja/Mpgv/'

MIN_CATALOGUE_ROWS = int(os.environ.get("MPGV_MIN_CATALOGUE_ROWS", "1000"))
MAX_CATALOGUE_DROP_FRACTION = float(
    os.environ.get("MPGV_MAX_CATALOGUE_DROP_FRACTION", "0.05")
)
MAX_PAGE_PARSE_LOSS_FRACTION = float(
    os.environ.get("MPGV_MAX_PAGE_PARSE_LOSS_FRACTION", "0.02")
)
RECENT_MONTH_GRACE_DAYS = int(
    os.environ.get("MPGV_RECENT_MONTH_GRACE_DAYS", "3")
)


class CatalogueValidationError(ValueError):
    """Candidate MPGV catalogue failed a safety or completeness check."""


def _expected_recent_period(now=None):
    """Return the latest year/month page that should normally be published."""
    now = now or datetime.now(timezone.utc)
    year = now.year
    month = now.month
    if now.day <= RECENT_MONTH_GRACE_DAYS:
        month -= 1
        if month == 0:
            year -= 1
            month = 12
    return str(year), f"{year}-{month:02d}"


def get_monthly_data(
    year,
    month,
    *,
    require_table=False,
    return_diagnostics=False,
    max_parse_loss_fraction=None,
):
    """Scrapes data for a specific month and filters by magnitude >= 3.0."""
    url = f"{BASE_URL}{year}/{year}-{str(month).zfill(2)}.html"
    response = requests.get(url, timeout=20)
    response.raise_for_status()
    soup = BeautifulSoup(response.content, 'html.parser')
    table = soup.find('table', class_='dataframe')

    if not table:
        if require_table:
            raise CatalogueValidationError(f"MPGV monthly table missing: {url}")
        return ([], None) if return_diagnostics else []

    tbody = table.find("tbody")
    if tbody is None:
        if require_table:
            raise CatalogueValidationError(f"MPGV monthly table body missing: {url}")
        return ([], None) if return_diagnostics else []

    data = []
    source_row_count = 0
    malformed_row_count = 0
    unavailable_magnitude_count = 0
    below_threshold_count = 0
    newest_source_id = None
    for row in tbody.find_all('tr'):
        source_row_count += 1
        cols = row.find_all('td')
        if len(cols) < 8:
            malformed_row_count += 1
            continue

        date_time_str = cols[0].text.strip()
        latitude = cols[1].text.strip()
        longitude = cols[2].text.strip()
        depth = cols[3].text.strip()
        mw_mean = cols[6].text.strip()
        if not date_time_str:
            malformed_row_count += 1
            continue

        try:
            try:
                datetime.strptime(date_time_str, '%Y-%m-%d %H:%M:%S.%f')
            except ValueError:
                datetime.strptime(date_time_str, '%Y-%m-%d %H:%M:%S')
        except ValueError:
            malformed_row_count += 1
            continue

        # Preserve the exact MPGV timestamp, including fractional seconds.
        source_id = date_time_str
        if newest_source_id is None or source_id > newest_source_id:
            newest_source_id = source_id
        try:
            mw_mean_value = float(mw_mean)
        except (TypeError, ValueError):
            # MPGV legitimately has rows without a calculated Mw mean. They are
            # not eligible catalogue rows and are tracked separately from
            # malformed eligible rows.
            unavailable_magnitude_count += 1
            continue
        if mw_mean_value < 3.0:
            below_threshold_count += 1
            continue

        try:
            latitude_value = float(latitude)
            longitude_value = float(longitude)
            depth_value = float(depth)
        except (TypeError, ValueError):
            malformed_row_count += 1
            continue

        data.append({
            "date_time": source_id,
            "source_id": source_id,
            "latitude": latitude_value,
            "longitude": longitude_value,
            "depth": depth_value,
            "mw_mean": mw_mean_value,
        })

    loss_limit = (
        MAX_PAGE_PARSE_LOSS_FRACTION
        if max_parse_loss_fraction is None
        else max_parse_loss_fraction
    )
    parse_loss_fraction = (
        malformed_row_count / source_row_count if source_row_count else 0.0
    )
    if require_table and malformed_row_count and parse_loss_fraction > loss_limit:
        raise CatalogueValidationError(
            "MPGV monthly parse loss exceeded safety limit: "
            f"{url} lost {malformed_row_count}/{source_row_count} rows "
            f"({parse_loss_fraction:.2%} > {loss_limit:.2%})"
        )

    diagnostics = {
        "url": url,
        "source_rows": source_row_count,
        "eligible_rows": len(data),
        "below_threshold_rows": below_threshold_count,
        "unavailable_magnitude_rows": unavailable_magnitude_count,
        "malformed_rows": malformed_row_count,
        "parse_loss_fraction": parse_loss_fraction,
        "newest_source_id": newest_source_id,
    }
    return (data, diagnostics) if return_diagnostics else data


def validate_candidate_catalogue(
    rows,
    *,
    prior_current_count=None,
    min_catalogue_rows=None,
    max_drop_fraction=None,
    allow_substantial_reduction=False,
):
    """Validate a complete in-memory candidate before changing current flags."""
    minimum = MIN_CATALOGUE_ROWS if min_catalogue_rows is None else min_catalogue_rows
    drop_limit = (
        MAX_CATALOGUE_DROP_FRACTION
        if max_drop_fraction is None
        else max_drop_fraction
    )
    if not rows:
        raise CatalogueValidationError("MPGV candidate catalogue was empty")
    if len(rows) < minimum:
        raise CatalogueValidationError(
            f"MPGV candidate catalogue too small: {len(rows)} < {minimum}"
        )

    source_ids = []
    for row in rows:
        source_id = str(row.get("source_id") or "")
        if row.get("date_time") != source_id:
            raise CatalogueValidationError(
                "MPGV date_time and exact source_id must be identical"
            )
        try:
            datetime.fromisoformat(source_id.replace("T", " "))
            if float(row["mw_mean"]) < 3.0:
                raise CatalogueValidationError(
                    f"Below-threshold row reached candidate catalogue: {source_id}"
                )
            float(row["latitude"])
            float(row["longitude"])
            float(row["depth"])
        except CatalogueValidationError:
            raise
        except (KeyError, TypeError, ValueError) as exc:
            raise CatalogueValidationError(
                f"Invalid MPGV candidate row: {source_id or '<missing identity>'}"
            ) from exc
        source_ids.append(source_id)

    if len(source_ids) != len(set(source_ids)):
        raise CatalogueValidationError(
            "MPGV candidate contains duplicate exact source timestamps"
        )

    if prior_current_count:
        reduction = prior_current_count - len(rows)
        reduction_fraction = reduction / prior_current_count
        if (
            reduction > 0
            and reduction_fraction > drop_limit
            and not allow_substantial_reduction
        ):
            raise CatalogueValidationError(
                "MPGV candidate rejected as a suspicious catalogue reduction: "
                f"{len(rows)} rows versus {prior_current_count} prior current rows "
                f"(drop {reduction_fraction:.2%}; "
                f"limit {drop_limit:.2%}). An explicit maintenance override is required."
            )
    return {
        "candidate_count": len(rows),
        "prior_current_count": prior_current_count,
    }


def fetch_authoritative_catalogue(*, now=None, min_catalogue_rows=None):
    """Fetch and validate the complete current MPGV magnitude-3+ catalogue."""
    response = requests.get(BASE_URL, timeout=20)
    response.raise_for_status()
    soup = BeautifulSoup(response.content, 'html.parser')
    year_links = sorted({
        a['href'].strip('/')
        for a in soup.find_all('a', href=re.compile(r'^\d{4}/$'))
    })
    if not year_links:
        raise CatalogueValidationError("MPGV index contained no year links")

    expected_year, expected_month = _expected_recent_period(now)
    if expected_year not in year_links:
        raise CatalogueValidationError(
            f"MPGV index missing expected recent year: {expected_year}"
        )

    rows = []
    page_diagnostics = []
    discovered_months = {}
    for year in year_links:
        year_url = f"{BASE_URL}{year}/"
        year_response = requests.get(year_url, timeout=20)
        year_response.raise_for_status()
        year_soup = BeautifulSoup(year_response.content, 'html.parser')
        month_links = sorted({
            a['href'].removesuffix('.html')
            for a in year_soup.find_all(
                'a', href=re.compile(r'^\d{4}-\d{2}\.html$')
            )
        })
        if not month_links:
            raise CatalogueValidationError(
                f"MPGV year index contained no month pages: {year_url}"
            )
        discovered_months[year] = month_links
        for month in month_links:
            _year, month_num = month.split('-')
            monthly_rows, diagnostics = get_monthly_data(
                year,
                month_num,
                require_table=True,
                return_diagnostics=True,
            )
            rows.extend(monthly_rows)
            page_diagnostics.append(diagnostics)

    if expected_month not in discovered_months.get(expected_year, []):
        raise CatalogueValidationError(
            f"MPGV year index missing expected recent month: {expected_month}"
        )
    recent_page = next(
        item for item in page_diagnostics
        if item["url"].endswith(f"/{expected_month}.html")
    )
    if (
        not recent_page["newest_source_id"]
        or not recent_page["newest_source_id"].startswith(expected_month)
    ):
        raise CatalogueValidationError(
            "MPGV expected recent page contained no source dates from "
            f"{expected_month}"
        )

    validate_candidate_catalogue(
        rows,
        min_catalogue_rows=min_catalogue_rows,
    )
    malformed_total = sum(item["malformed_rows"] for item in page_diagnostics)
    if malformed_total:
        logging.warning(
            "MPGV candidate accepted with %d malformed source rows within configured limits.",
            malformed_total,
        )
    return rows


def _mutable_signature(row):
    return (
        float(row["latitude"]),
        float(row["longitude"]),
        float(row["depth"]),
        float(row["mw_mean"]),
    )


def _legacy_row_signature(row):
    return (row["source_id"][:19], *_mutable_signature(row))


def sync_authoritative_rows(
    rows,
    *,
    commit=True,
    allow_substantial_reduction=False,
    max_drop_fraction=None,
):
    """Mark current MPGV snapshots without deleting historical raw revisions."""
    from app import db, Earthquake

    prior_current_count = Earthquake.query.filter(
        Earthquake.is_current.is_(True),
        Earthquake.source_id.isnot(None),
        Earthquake.mw_mean >= 3.0,
    ).count()
    validate_candidate_catalogue(
        rows,
        prior_current_count=prior_current_count,
        min_catalogue_rows=1,
        max_drop_fraction=max_drop_fraction,
        allow_substantial_reduction=allow_substantial_reduction,
    )

    existing_rows = Earthquake.query.all()
    existing_source_ids = {
        existing.source_id for existing in existing_rows if existing.source_id
    }
    by_exact_signature = {}
    by_legacy_signature = {}
    for existing in existing_rows:
        mutable = (
            float(existing.latitude),
            float(existing.longitude),
            float(existing.depth),
            float(existing.mw_mean),
        )
        if existing.source_id:
            by_exact_signature.setdefault(
                (existing.source_id, *mutable), []
            ).append(existing)
        by_legacy_signature.setdefault(
            (existing.date_time[:19], *mutable), []
        ).append(existing)

    try:
        # Candidate validation is complete before this first state change.
        claimed_ids = set()
        db.session.query(Earthquake).update(
            {Earthquake.is_current: False},
            synchronize_session="fetch",
        )
        db.session.flush()

        inserted = 0
        reactivated = 0
        new_revisions = 0
        for row in rows:
            exact_signature = (row["source_id"], *_mutable_signature(row))
            candidate = next(
                (
                    existing
                    for existing in by_exact_signature.get(exact_signature, [])
                    if existing.id not in claimed_ids
                ),
                None,
            )
            if candidate is None:
                candidate = next(
                    (
                        existing
                        for existing in by_legacy_signature.get(
                            _legacy_row_signature(row), []
                        )
                        if existing.id not in claimed_ids
                        and existing.source_id is None
                    ),
                    None,
                )
            if candidate is None:
                candidate = Earthquake(
                    date_time=row["source_id"],
                    latitude=row["latitude"],
                    longitude=row["longitude"],
                    depth=row["depth"],
                    mw_mean=row["mw_mean"],
                )
                db.session.add(candidate)
                inserted += 1
                if row["source_id"] in existing_source_ids:
                    new_revisions += 1
            else:
                reactivated += 1
            claimed_ids.add(candidate.id)

            candidate.source_id = row["source_id"]
            candidate.is_current = True

        db.session.flush()
        active_count = Earthquake.query.filter(
            Earthquake.is_current.is_(True)
        ).count()
        if active_count != len(rows):
            raise CatalogueValidationError(
                f"MPGV current-row validation failed: expected {len(rows)}, "
                f"got {active_count}"
            )

        if commit:
            db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    return {
        "authoritative": len(rows),
        "inserted": inserted,
        "reactivated": reactivated,
        "inactive": len(existing_rows) + inserted - len(rows),
        "source_current": len(rows),
        "new_rows": inserted,
        "reactivated_unchanged": reactivated,
        "new_revisions": new_revisions,
        "retained_inactive_revisions": len(existing_rows) + inserted - len(rows),
        "new_current_events": len(
            {row["source_id"] for row in rows} - existing_source_ids
        ),
        "newest_current_identity": max(row["source_id"] for row in rows),
    }

def scrape_all_earthquake_data():
    """Scrape MPGV and insert new records (M ≥ 3.0) into the database."""
    if USING_FLASK:
        from app import app, db, Earthquake
        with app.app_context():
            return _scrape_and_save_with_flask()
    return _scrape_and_save_with_sqlite()

def _scrape_and_save_with_flask():
    """Synchronize active MPGV snapshots atomically via SQLAlchemy."""
    from app import db

    try:
        summary = sync_authoritative_rows(fetch_authoritative_catalogue())
    except Exception:
        db.session.rollback()
        raise
    logging.info(
        "MPGV acquisition complete source_current=%s new_current_events=%s "
        "new_rows=%s reactivated_unchanged=%s new_revisions=%s "
        "retained_inactive_revisions=%s newest_current_identity=%s",
        summary["source_current"],
        summary["new_current_events"],
        summary["new_rows"],
        summary["reactivated_unchanged"],
        summary["new_revisions"],
        summary["retained_inactive_revisions"],
        summary["newest_current_identity"],
    )
    return summary

def _scrape_and_save_with_sqlite():
    """Standalone fallback using the same authoritative snapshot lifecycle."""
    rows = fetch_authoritative_catalogue()
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS earthquake (
        id INTEGER PRIMARY KEY,
        date_time TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        depth REAL NOT NULL,
        mw_mean REAL NOT NULL,
        source_id TEXT,
        is_current INTEGER NOT NULL DEFAULT 1,
        UNIQUE(date_time, latitude, longitude)
    )
    ''')
    columns = {row[1] for row in cursor.execute("PRAGMA table_info(earthquake)")}
    if "source_id" not in columns:
        cursor.execute("ALTER TABLE earthquake ADD COLUMN source_id TEXT")
    if "is_current" not in columns:
        cursor.execute(
            "ALTER TABLE earthquake ADD COLUMN is_current INTEGER NOT NULL DEFAULT 1"
        )

    try:
        prior_current_count = cursor.execute(
            "SELECT COUNT(*) FROM earthquake "
            "WHERE is_current = 1 AND source_id IS NOT NULL AND mw_mean >= 3.0"
        ).fetchone()[0]
        validate_candidate_catalogue(
            rows,
            prior_current_count=prior_current_count,
            min_catalogue_rows=1,
        )
        cursor.execute("BEGIN")
        existing = cursor.execute(
            "SELECT id, date_time, latitude, longitude, depth, mw_mean, source_id "
            "FROM earthquake"
        ).fetchall()
        by_exact_signature = {}
        by_legacy_signature = {}
        for item in existing:
            mutable = tuple(map(float, item[2:6]))
            if item[6]:
                by_exact_signature.setdefault(
                    (item[6], *mutable), []
                ).append(item[0])
            by_legacy_signature.setdefault(
                (item[1][:19], *mutable), []
            ).append((item[0], item[6]))
        cursor.execute("UPDATE earthquake SET is_current = 0")
        claimed_ids = set()
        for row in rows:
            candidate_id = next(
                (
                    row_id
                    for row_id in by_exact_signature.get(
                        (row["source_id"], *_mutable_signature(row)), []
                    )
                    if row_id not in claimed_ids
                ),
                None,
            )
            if candidate_id is None:
                candidate_id = next(
                    (
                        row_id
                        for row_id, existing_source_id in by_legacy_signature.get(
                            _legacy_row_signature(row), []
                        )
                        if row_id not in claimed_ids and existing_source_id is None
                    ),
                    None,
                )
            if candidate_id is None:
                cursor.execute(
                    "INSERT INTO earthquake "
                    "(date_time, latitude, longitude, depth, mw_mean, source_id, is_current) "
                    "VALUES (?, ?, ?, ?, ?, ?, 1)",
                    (
                        row["source_id"],
                        row["latitude"],
                        row["longitude"],
                        row["depth"],
                        row["mw_mean"],
                        row["source_id"],
                    ),
                )
            else:
                claimed_ids.add(candidate_id)
                cursor.execute(
                    "UPDATE earthquake SET source_id = ?, is_current = 1 WHERE id = ?",
                    (row["source_id"], candidate_id),
                )
        cursor.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_earthquake_current_source_id "
            "ON earthquake(source_id) WHERE is_current = 1 AND source_id IS NOT NULL"
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    print(f"MPGV synchronized: {len(rows)} current rows (direct SQLite).")
    return {
        "authoritative": len(rows),
        "prior_current": prior_current_count,
    }

if __name__ == "__main__":
    scrape_all_earthquake_data()
