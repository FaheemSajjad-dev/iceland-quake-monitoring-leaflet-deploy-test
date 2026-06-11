from datetime import datetime, timedelta, timezone
import time as _time
import requests
from app import app, db, EarthquakeSRaw


API_URL = "https://api.vedur.is/quakes/events"

CUTOFF_UTC = datetime(2020, 6, 1, 0, 0, 0, tzinfo=timezone.utc)

DEFAULT_TIMEOUT = 20
DEFAULT_RETRIES = 3
DEFAULT_BACKOFF = 0.8

DEFAULT_MIN_MAG = 3.0


def _fmt_iso(dt):
    """Format datetime as ISO 8601 UTC string for the Quakes API."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    dt = dt.astimezone(timezone.utc).replace(microsecond=0)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _fmt_utc(dt):
    """Format datetime as YYYY-MM-DD HH:MM:SS for DB storage."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    dt = dt.astimezone(timezone.utc).replace(microsecond=0)
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def _get_with_retry(url, params, timeout=DEFAULT_TIMEOUT, retries=DEFAULT_RETRIES, backoff=DEFAULT_BACKOFF):
    last_err = None
    for i in range(retries):
        try:
            r = requests.get(url, params=params, timeout=timeout)
            r.raise_for_status()
            return r
        except Exception as e:
            last_err = e
            _time.sleep((i + 1) * backoff)
    raise last_err


def _safe_float(x):
    try:
        if x is None:
            return None
        return float(x)
    except Exception:
        return None


def _parse_iso_to_utc_str(t_val):
    """Parse ISO 8601 timestamp to 'YYYY-MM-DD HH:MM:SS' in UTC."""
    if not isinstance(t_val, str):
        return None
    try:
        normalized = t_val.strip().replace("Z", "+00:00")
        dt = datetime.fromisoformat(normalized)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return _fmt_utc(dt)
    except Exception:
        return None


def fetch_skjalftalisa(start_time_utc, end_time_utc, size_min=DEFAULT_MIN_MAG, fields=None):
    """Fetch earthquakes from the IMO Quakes API as GeoJSON.

    The function name is kept for compatibility with the rest of the backend;
    the old Skjalftalisa endpoint was replaced by https://api.vedur.is/quakes/.
    """
    if start_time_utc.tzinfo is None:
        start_time_utc = start_time_utc.replace(tzinfo=timezone.utc)
    if end_time_utc.tzinfo is None:
        end_time_utc = end_time_utc.replace(tzinfo=timezone.utc)

    if end_time_utc < CUTOFF_UTC:
        return []
    start_time_utc = max(start_time_utc, CUTOFF_UTC)

    params = {
        "start_time": _fmt_iso(start_time_utc),
        "end_time": _fmt_iso(end_time_utc),
        "size_min": float(size_min),
        "format": "json",
    }

    r = _get_with_retry(API_URL, params=params)
    payload = r.json()
    features = payload.get("features") if isinstance(payload, dict) else []
    if not isinstance(features, list):
        return []

    results = []
    for feat in features:
        if not isinstance(feat, dict):
            continue

        props = feat.get("properties") or {}
        geometry = feat.get("geometry") or {}
        coords = geometry.get("coordinates") or []

        if len(coords) < 2:
            continue

        lon = _safe_float(coords[0])  # GeoJSON is [lon, lat]
        lat = _safe_float(coords[1])
        dep = _safe_float(props.get("depth"))
        mag = _safe_float(props.get("magnitude"))
        t_str = _parse_iso_to_utc_str(props.get("time"))

        if t_str is None or lat is None or lon is None:
            continue

        results.append({
            "event_id": props.get("event_id"),
            "time": t_str,
            "lat": lat,
            "long": lon,
            "depth": dep,
            "magnitude": mag,
        })

    return results


def fetch_last_n_days(n_days=30, size_min=DEFAULT_MIN_MAG):
    end = datetime.now(timezone.utc).replace(microsecond=0)
    start = end - timedelta(days=n_days)
    return fetch_skjalftalisa(start, end, size_min=size_min)


def store_skjalftalisa_rows(rows):
    """Upsert Quakes API rows by event_id."""
    if not rows:
        return

    inserted = 0
    updated = 0

    with app.app_context():
        for r in rows:
            ev_id = str(r.get("event_id") or "").strip()
            if not ev_id:
                continue

            rec = EarthquakeSRaw.query.filter_by(event_id=ev_id).first()
            if rec:
                changed = (
                    rec.date_time != r["time"] or
                    rec.latitude != r["lat"] or
                    rec.longitude != r["long"] or
                    rec.depth != r.get("depth") or
                    rec.magnitude != r.get("magnitude")
                )
                if changed:
                    rec.date_time = r["time"]
                    rec.latitude = r["lat"]
                    rec.longitude = r["long"]
                    rec.depth = r.get("depth")
                    rec.magnitude = r.get("magnitude")
                    updated += 1
            else:
                db.session.add(EarthquakeSRaw(
                    event_id=ev_id,
                    date_time=r["time"],
                    latitude=r["lat"],
                    longitude=r["long"],
                    depth=r.get("depth"),
                    magnitude=r.get("magnitude"),
                ))
                inserted += 1

        db.session.commit()

    if inserted > 0 or updated > 0:
        print(f"Inserted {inserted} | Updated {updated} Quakes API rows.")


def backfill_skjalftalisa_since_2020(size_min=2.0):
    start = datetime(2020, 6, 1, 0, 0, 0, tzinfo=timezone.utc)
    end = datetime.now(timezone.utc).replace(microsecond=0)

    total = 0
    cur_start = start
    while cur_start < end:
        cur_end = min(cur_start + timedelta(days=365) - timedelta(seconds=1), end)
        rows = fetch_skjalftalisa(cur_start, cur_end, size_min=size_min)
        store_skjalftalisa_rows(rows)
        total += len(rows)
        print(f"Stored {len(rows)} rows for {cur_start:%Y-%m-%d} to {cur_end:%Y-%m-%d}")
        cur_start = cur_end + timedelta(seconds=1)

    print(f"Backfill complete. Total fetched: {total}")


if __name__ == "__main__":
    print("Quakes API probe: last 30 days, size_min=0.0")
    rows = fetch_last_n_days(30, size_min=0.0)
    print(f"Fetched {len(rows)} rows.")
    for q in rows[:3]:
        print(q)

    print("Storing in SQLite...")
    store_skjalftalisa_rows(rows)