"""
Fetch Icelandic volcano metadata from the EPOS API and store in SQLite.

Tries the current endpoint first, falls back to /v1/ if unavailable.
Normalises field names across different API response schemas.
"""
import os
import re
import time
import sqlite3
import unicodedata
import requests

BASE = "https://api.vedur.is/epos"
ENDPOINTS = {
    "status": (
        "/volcano/general-information/volcanoes-status",
        "/v1/volcano/general-information/volcanoes-status",
    ),
    "catalog": (
        "/volcano/general-information/list-of-volcanoes",
        "/v1/volcano/general-information/list-of-volcanoes",
    ),
    "eruptions": (
        "/volcano/general-information/list-of-eruptions",
        "/v1/volcano/general-information/list-of-eruptions",
    ),
}
DEFAULT_HEADERS = {
    "Accept": "application/json",
}
MIN_VALID_VOLCANO_ROWS = int(os.environ.get("MIN_VALID_VOLCANO_ROWS", "5"))

def _get_json(url, timeout=25):
    for i in range(3):
        try:
            r = requests.get(url, headers=DEFAULT_HEADERS, timeout=timeout)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            if i == 2:
                print(f"GET {url} failed: {e}")
                return None
            time.sleep(0.7 * (i + 1))
    return None


def _get_first_json(paths, timeout=25):
    if isinstance(paths, str):
        paths = (paths,)

    for path in paths:
        url = BASE + path
        payload = _get_json(url, timeout=timeout)
        if payload is not None:
            return payload
    return None


def _extract_items(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("data", "items", "results", "features"):
            value = payload.get(key)
            if isinstance(value, list):
                return value
    return []

def _norm_name(s):
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = re.sub(r"[^a-zA-Z0-9]+", "", s).lower()
    return s

def _ft(m):
    try:
        return float(m) * 3.28084 if m is not None else None
    except Exception:
        return None

def fetch_and_merge():
    catalog = _get_first_json(ENDPOINTS["catalog"]) or []

    merged = []
    for v in _extract_items(catalog):
        name = v.get("name") or v.get("volcano_name") or v.get("system_name") or v.get("title")
        lat = v.get("latitude")
        if lat is None:
            lat = v.get("lat_dd")
        if lat is None:
            lat = v.get("lat")

        lon = v.get("longitude")
        if lon is None:
            lon = v.get("lon_dd")
        if lon is None:
            lon = v.get("lon")

        if not name or lat is None or lon is None:
            continue

        height = v.get("height") or v.get("elevation") or v.get("elevation_m")
        try:
            height = float(height) if height not in (None, "", "NaN") else None
        except Exception:
            height = None

        merged.append({
            "name": name.strip(),
            "description": v.get("area") or "No additional information available.",
            "elevation_m": height,
            "elevation_ft": _ft(height),
            "latitude": float(lat),
            "longitude": float(lon),
            "last_eruption": None,  # not available from this endpoint
        })

    if merged:
        print(f"Loaded {len(merged)} volcanoes from EPOS catalog.")
        return merged

    print("EPOS catalog returned no usable volcano rows.")
    return []

def save_volcanoes_to_db(volcanoes, db_path=None):
    if not volcanoes:
        print("No volcano data to save, skipping update.")
        return False

    if len(volcanoes) < MIN_VALID_VOLCANO_ROWS:
        print("Too few volcano rows to safely replace existing data.")
        return False

    if db_path is None:
        current_file_path = os.path.dirname(os.path.abspath(__file__))
        db_dir = os.path.join(current_file_path, "data")
        os.makedirs(db_dir, exist_ok=True)
        db_path = os.path.join(db_dir, "earthquakes.db")

    prepared_rows = []
    for v in volcanoes:
        name = (v.get("name") or "").strip()
        latitude = float(v["latitude"])
        longitude = float(v["longitude"])
        if not name or not (-90.0 <= latitude <= 90.0) or not (-180.0 <= longitude <= 180.0):
            raise ValueError("invalid volcano row")
        prepared_rows.append((
            name,
            v.get("description"),
            v.get("elevation_m"),
            v.get("elevation_ft"),
            latitude,
            longitude,
            v.get("last_eruption"),
        ))

    conn = sqlite3.connect(db_path)
    try:
        cur = conn.cursor()
        cur.execute("""
        CREATE TABLE IF NOT EXISTS volcano (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            elevation_m FLOAT,
            elevation_ft FLOAT,
            latitude FLOAT,
            longitude FLOAT,
            last_eruption TEXT,
            UNIQUE(name, latitude, longitude)
        )
        """)

        cur.execute("BEGIN")
        cur.execute("DELETE FROM volcano")
        cur.executemany("""
            INSERT OR REPLACE INTO volcano
            (name, description, elevation_m, elevation_ft, latitude, longitude, last_eruption)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, prepared_rows)
        count = cur.rowcount if cur.rowcount != -1 else len(prepared_rows)
        if count < MIN_VALID_VOLCANO_ROWS:
            raise ValueError("too few volcano rows inserted")
        conn.commit()
    except Exception:
        conn.rollback()
        print("Volcano replacement failed; previous rows were preserved by rollback.")
        raise
    finally:
        conn.close()
    print(f"Saved {count} volcano rows.")
    return count > 0

def refresh_volcanoes(db_path=None):
    rows = fetch_and_merge()
    if not rows:
        print("No volcanoes loaded.")
        return False
    return save_volcanoes_to_db(rows, db_path)

if __name__ == "__main__":
    refresh_volcanoes()
