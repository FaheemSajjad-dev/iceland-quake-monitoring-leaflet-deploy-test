from __future__ import annotations
from typing import Iterable, List, Dict, Optional, Tuple
from datetime import datetime, timedelta, timezone
import time as _time
import requests
from app import app, db, EarthquakeSRaw


API_URL = "https://api.vedur.is/skjalftalisa/v1/quake/array"

# Don’t fetch data before this date
CUTOFF_UTC = datetime(2020, 6, 1, 0, 0, 0, tzinfo=timezone.utc)

# API limit: max 1 year per request
MAX_SPAN_DAYS = 365
DEFAULT_TIMEOUT = 20
DEFAULT_RETRIES = 3
DEFAULT_BACKOFF = 0.8

DEFAULT_MIN_MAG = 2.7

# ---- Utilities --------------------------------------------------------------

def _fmt_utc(dt: datetime) -> str:
    """Format aware datetime to 'YYYY-MM-DD HH:MM:SS' in UTC."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    dt = dt.astimezone(timezone.utc).replace(microsecond=0)
    return dt.strftime("%Y-%m-%d %H:%M:%S")

def _chunk_ranges(start_utc: datetime, end_utc: datetime, max_days: int = MAX_SPAN_DAYS) -> Iterable[Tuple[datetime, datetime]]:
    """Yield [start, end] chunks where span <= max_days."""
    if start_utc.tzinfo is None:
        start_utc = start_utc.replace(tzinfo=timezone.utc)
    if end_utc.tzinfo is None:
        end_utc = end_utc.replace(tzinfo=timezone.utc)

    cur = start_utc
    one_day = timedelta(days=1)
    while cur <= end_utc:
        nxt = min(cur + timedelta(days=max_days) - one_day, end_utc)
        yield (cur, nxt)
        cur = nxt + one_day

def _post_with_retry(url: str, json: dict, timeout: int = DEFAULT_TIMEOUT,
                     retries: int = DEFAULT_RETRIES, backoff: float = DEFAULT_BACKOFF) -> requests.Response:
    """POST with simple exponential backoff."""
    last_err = None
    for i in range(retries):
        try:
            r = requests.post(url, json=json, timeout=timeout)
            r.raise_for_status()
            return r
        except Exception as e:
            last_err = e
            _time.sleep((i + 1) * backoff)
    raise last_err  # type: ignore[misc]

def _safe_float(x):
    try:
        if x is None:
            return None
        return float(x)
    except Exception:
        return None

def _normalize_time_to_utc_str(t_val) -> Optional[str]:
    """
    API returns 'time' as a UNIX timestamp (int) OR sometimes as a string.
    Normalize to 'YYYY-MM-DD HH:MM:SS' (UTC).
    """
    if isinstance(t_val, (int, float)):
        dt = datetime.fromtimestamp(t_val, tz=timezone.utc)
        return _fmt_utc(dt)
    if isinstance(t_val, str):
        # Try to parse common forms; if it already looks like 'YYYY-MM-DD HH:MM:SS', use as-is.
        # We keep it simple: if parsing fails, return None.
        try:
            if "T" in t_val:  # ISO-ish: 'YYYY-MM-DDTHH:MM:SSZ'
                t_val = t_val.replace("Z", " ").replace("T", " ").strip()
            # strip fractional seconds, if any
            t_val = t_val.split(".")[0]
            dt = datetime.strptime(t_val, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
            return _fmt_utc(dt)
        except Exception:
            return None
    return None

# ---- Public API -------------------------------------------------------------

def fetch_skjalftalisa(
    start_time_utc: datetime,
    end_time_utc: datetime,
    size_min: float = DEFAULT_MIN_MAG,
    fields: Optional[Iterable[str]] = None,
) -> List[Dict]:
    """
    Fetch earthquakes from Skjálftalísa within [start_time_utc, end_time_utc] UTC.
    Respects the 1-year-per-request limit by chunking.
    Returns a list of dicts with keys:
      - event_id (int or str)
      - time (str, 'YYYY-MM-DD HH:MM:SS' UTC)
      - lat (float)
      - long (float)
      - depth (float or None)
      - magnitude (float or None)
    """
    # Enforce UTC awareness
    if start_time_utc.tzinfo is None:
        start_time_utc = start_time_utc.replace(tzinfo=timezone.utc)
    if end_time_utc.tzinfo is None:
        end_time_utc = end_time_utc.replace(tzinfo=timezone.utc)

    # Apply the global cutoff (June 1, 2020)
    if end_time_utc < CUTOFF_UTC:
        return []
    start_time_utc = max(start_time_utc, CUTOFF_UTC)

    if fields is None:
        fields = ["event_id", "lat", "long", "time", "magnitude", "depth"]

    results: List[Dict] = []

    for chunk_start, chunk_end in _chunk_ranges(start_time_utc, end_time_utc, MAX_SPAN_DAYS):
        body = {
            "start_time": _fmt_utc(chunk_start),
            "end_time":   _fmt_utc(chunk_end),
            "size_min":   float(size_min),
            "event_type": ["qu"],
            "fields":     list(fields),
            "sort":       []
        }

        r = _post_with_retry(API_URL, json=body)
        payload = r.json()
        data = payload.get("data", {})

        # The service returns columnar arrays: data = { "lat": [...], "long": [...], ... }
        # When no results exist it returns {"lat": null, ...} instead of {"lat": [], ...}
        if not isinstance(data, dict) or not data:
            continue
        keys = list(data.keys())
        first_col = data[keys[0]] if keys else None
        if not isinstance(first_col, list):
            continue  # null columns = no results for this chunk

        n_rows = len(first_col)
        for i in range(n_rows):
            raw = {k: data[k][i] for k in keys}

            t_str = _normalize_time_to_utc_str(raw.get("time"))
            lat = _safe_float(raw.get("lat"))
            lon = _safe_float(raw.get("long"))
            dep = _safe_float(raw.get("depth"))
            mag = _safe_float(raw.get("magnitude"))

            if t_str is None or lat is None or lon is None:
                continue

            results.append({
                "event_id": raw.get("event_id"),
                "time": t_str,
                "lat": lat,
                "long": lon,
                "depth": dep,
                "magnitude": mag,
            })

    return results

def fetch_last_n_days(n_days: int = 30, size_min: float = DEFAULT_MIN_MAG) -> List[Dict]:
    """Convenience helper: fetch last N days (UTC)."""
    end = datetime.now(timezone.utc).replace(microsecond=0)
    start = end - timedelta(days=n_days)
    return fetch_skjalftalisa(start, end, size_min=size_min)

def store_skjalftalisa_rows(rows):
    """
    Insert/update Skjálftalísa rows by event_id.
    Safe to call repeatedly; unchanged rows are updated idempotently.
    """
    if not rows:
        return

    inserted = 0
    updated  = 0

    with app.app_context():
        for r in rows:
            ev_id = str(r.get("event_id") or "").strip()
            if not ev_id:
                continue

            rec = EarthquakeSRaw.query.filter_by(event_id=ev_id).first()
            if rec:
                changed = (
                    rec.date_time != r["time"] or
                    rec.latitude  != r["lat"]  or
                    rec.longitude != r["long"] or
                    rec.depth     != r.get("depth") or
                    rec.magnitude != r.get("magnitude")
                )
                if changed:
                    rec.date_time = r["time"]
                    rec.latitude  = r["lat"]
                    rec.longitude = r["long"]
                    rec.depth     = r.get("depth")
                    rec.magnitude = r.get("magnitude")
                    updated += 1
            else:
                db.session.add(EarthquakeSRaw(
                    event_id = ev_id,
                    date_time= r["time"],
                    latitude = r["lat"],
                    longitude= r["long"],
                    depth    = r.get("depth"),
                    magnitude= r.get("magnitude"),
                ))
                inserted += 1

        db.session.commit()

    if inserted > 0 or updated > 0:
        print(f"Inserted {inserted} | Updated {updated} Skjálftalísa rows.")


def backfill_skjalftalisa_since_2020(size_min: float = 2.0):
    """
    Fetch Skjálftalísa in yearly chunks from 2020-06-01 → now and store to earthquake_s_raw.
    size_min=2.0 is a good balance (you can use 0.0 but it'll be much slower).
    """
    start = datetime(2020, 6, 1, 0, 0, 0, tzinfo=timezone.utc)
    end   = datetime.now(timezone.utc).replace(microsecond=0)

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
    print("Skjálftalísa probe: last 30 days, size_min=0.0")
    rows = fetch_last_n_days(30, size_min=0.0)
    print(f"Fetched {len(rows)} rows.")
    for q in rows[:3]:
        print(q)

    print("Storing in SQLite...")
    store_skjalftalisa_rows(rows)