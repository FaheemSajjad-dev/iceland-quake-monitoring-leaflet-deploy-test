# Backend Architecture & Design Decisions

## Iceland Earthquake Monitoring System — Backend Documentation

---

## 1. Technology Stack

| Component | Technology |
|-----------|-----------|
| Web Framework | Flask (Python) |
| ORM | SQLAlchemy (via Flask-SQLAlchemy) |
| Database | SQLite (WAL mode) |
| Scheduler | APScheduler (BackgroundScheduler) |
| HTTP Client | Requests |
| HTML Parser | BeautifulSoup4 |

Flask was chosen for its simplicity — the backend is essentially a data pipeline with a REST API on top, not a full web application. APScheduler keeps the polling logic in-process without requiring Redis or Celery, which would be overkill for a single-server deployment.

---

## 2. System Architecture Overview

```
                        +---------------------------+
                        |     APScheduler           |
                        |   (every 3 minutes)       |
                        +---------------------------+
                                    |
              +---------------------+---------------------+
              |                     |                     |
              v                     v                     v
     +----------------+   +------------------+   +----------------+
     |   scrape.py    |   | skjalftalisa_    |   | reconcile.py   |
     |  (MPGV HTML)   |   | client.py (API)  |   | (Match & Merge)|
     +----------------+   +------------------+   +----------------+
              |                     |                     |
              v                     v                     v
     +----------------+   +------------------+   +------------------+
     |  Earthquake    |   | EarthquakeSRaw   |   | EarthquakeMerged |
     |  (MPGV table)  |   | (Skjalftalisa)   |   |  (display table) |
     +----------------+   +------------------+   +------------------+
                                                          |
                                                          v
                                                 +------------------+
                                                 |  Flask REST API  |
                                                 |  GET /earthquakes|
                                                 |  (cached 60s)    |
                                                 +------------------+
                                                          |
                                                          v
                                                 +------------------+
                                                 |   React Frontend |
                                                 |  (polls every    |
                                                 |   3 minutes)     |
                                                 +------------------+
```

---

## 3. Database Schema

### 3.1 Tables

```
+-------------------+     +-------------------+     +---------------------+
|    Earthquake     |     |  EarthquakeSRaw   |     |  EarthquakeMerged   |
| (MPGV source "v") |     | (Skjalftalisa "s")|     | (reconciled output) |
+-------------------+     +-------------------+     +---------------------+
| id (PK, int)      |     | id (PK, int)      |     | id (PK, int)        |
| date_time (str)   |     | event_id (str, UQ) |     | date_time (str, IX) |
| latitude (float)  |     | date_time (str,IX) |     | latitude (float)    |
| longitude (float) |     | latitude (float)   |     | longitude (float)   |
| depth (float)     |     | longitude (float)  |     | depth (float)       |
| mw_mean (float)   |     | depth (float)      |     | mw_mean (float)     |
+-------------------+     | magnitude (float)  |     | status (str)        |
| UQ: date_time +   |     +-------------------+     | v_src_key (str)     |
|   latitude +      |                               | s_event_id (str)    |
|   longitude       |                               | match_dt_sec (float)|
+-------------------+                               | match_dist_km (fl)  |
                                                     | match_dm (float)    |
+-------------------+     +-------------------+     +---------------------+
|     Volcano       |     |   ShakeMapLink    |
+-------------------+     +-------------------+
| id (PK, int)      |     | dt (PK, str)      |
| name (str)        |     | url_view_file(str)|
| description (text)|     | sm_lat (float)    |
| elevation_m (fl)  |     | sm_lon (float)    |
| elevation_ft (fl) |     | sm_mag (float)    |
| latitude (float)  |     | sm_depth (float)  |
| longitude (float) |     | dt_sec (float)    |
| last_eruption(str)|     | dist_km (float)   |
+-------------------+     | dm (float)        |
| UQ: name + lat +  |     | status (str)      |
|     longitude     |     | note (str)        |
+-------------------+     +-------------------+
```

**IX** = indexed column, **UQ** = unique constraint, **PK** = primary key

### 3.2 Why SQLite?

The dataset is small (~1,800 merged rows, ~4,900 Skjalftalisa rows) and the write pattern is simple: one writer every 3 minutes from the scheduler. SQLite in WAL mode handles concurrent reads fine under those conditions, and it eliminates the need to run a separate database server. Backup is a single file copy. For this scale it's the obvious choice.

### 3.3 SQLite Configuration

```python
PRAGMA journal_mode = WAL;      # Write-Ahead Logging — readers don't block writers
PRAGMA synchronous = NORMAL;    # Balanced durability vs speed (safe for WAL mode)
```

---

## 4. Data Pipeline

### 4.1 Pipeline Stages

```
Stage 1: SCRAPE               Stage 2: FETCH               Stage 3: RECONCILE
+-------------------+         +-------------------+         +-------------------+
| scrape.py         |         | skjalftalisa_     |         | reconcile.py      |
|                   |         | client.py         |         |                   |
| Source: MPGV HTML |         | Source: IMO API   |         | Input: V + S rows |
| hraun.vedur.is    |         | api.vedur.is      |         | Output: Merged    |
|                   |         |                   |         |                   |
| Filter: Mw >= 2.7 |         | Filter: Mw >= 2.7 |         | Match thresholds: |
| Output: Earthquake|         | Window: last 7 d  |         |  dist < 10 km     |
|                   |         | Output: SRaw      |         |  |dt| <= 2 sec    |
+-------------------+         +-------------------+         |  |dm| < 3.0       |
                                                            +-------------------+
```

### 4.2 Scheduling

- **Interval**: Every 3 minutes
- **Engine**: APScheduler `BackgroundScheduler`
- **Concurrency guard**: `max_instances=1` (prevents overlapping runs)
- **Misfire tolerance**: 60 seconds (if a run is delayed, it still executes)
- **Start trigger**: Lazy start on first HTTP request (`@app.before_request`)

### 4.3 MPGV Scraper (`scrape.py`)

**Data source**: `http://hraun.vedur.is/ja/Mpgv/`

**How it works**:
1. Fetches the MPGV index page listing available years
2. For each year, fetches monthly HTML files (e.g., `2024-03.html`)
3. Parses HTML `<table class="dataframe">` using BeautifulSoup
4. Extracts columns: date_time, latitude, longitude, depth, mw_mean
5. Filters: only events with Mw >= 2.7 and all required fields present
6. Inserts into `Earthquake` table (duplicates rejected by unique constraint)

**Robustness**:
- HTTP timeout: 20 seconds per request
- Skips months with no data or parse errors
- Deduplication via database unique constraint (date_time + lat + lon)

### 4.4 Skjalftalisa Client (`skjalftalisa_client.py`)

**Data source**: `https://api.vedur.is/skjalftalisa/v1/quake/array` (POST)

**How it works**:
1. Sends POST request with time range, magnitude filter, event type
2. API returns columnar arrays (lat[], lon[], time[], magnitude[], etc.)
3. Transposes columns into row-based records
4. Normalises timestamps (handles both UNIX and ISO string formats)
5. Upserts into `EarthquakeSRaw` table by `event_id`

**Key design decisions**:
- Rolling 7-day window per cycle (incremental, not full history each time)
- API limit: 365 days per request (auto-chunked for longer ranges)
- Retry logic: 3 attempts with exponential backoff (0.8s base)
- Historical backfill available via `backfill_skjalftalisa_since_2020()`

### 4.5 Reconciliation Engine (`reconcile.py`)

**Purpose**: Merge MPGV (v) and Skjalftalisa (s) events into a single clean dataset for map display.

**Why two sources need merging**:
- MPGV provides moment magnitude (Mw) and timing but has coarser location data
- Skjalftalisa provides precise IMO-reviewed locations and depths
- Combining both yields the best of each: precise Mw from MPGV + precise location from Skjalftalisa

**Matching algorithm**:

```
For each MPGV event (v):
    1. Compute time window: v.date_time +/- 2 seconds
    2. Find all Skjalftalisa candidates (s) within that window
    3. For each candidate, check:
       - Haversine distance < 10 km?
       - |Mw_v - M_s| < 3.0?
    4. If exactly 1 candidate passes -> MATCHED
       If 0 candidates pass          -> V_ONLY
       If 2+ candidates pass         -> AMBIGUOUS -> treat as V_ONLY
```

**Output field selection for matched events**:

| Field | Source | Reason |
|-------|--------|--------|
| date_time | MPGV (v) | MPGV timestamps are precise for moment tensor analysis |
| latitude | Skjalftalisa (s) | IMO-reviewed locations are more accurate |
| longitude | Skjalftalisa (s) | IMO-reviewed locations are more accurate |
| depth | Skjalftalisa (s) | IMO-reviewed depths are more reliable |
| mw_mean | MPGV (v) | Moment magnitude from MPGV is the primary scientific value |

**Reconciliation statistics** (as of March 2026):

| Status | Count | Percentage |
|--------|-------|-----------|
| Matched (v + s) | 1,447 | 81.2% |
| V-only (MPGV only) | 334 | 18.8% |
| S-only (stored, not displayed) | 3,534 | — |

**Why 81% match rate is good**: Most significant earthquakes (Mw >= 2.7) are detected by both systems. The 19% v-only events are typically older events or those where Skjalftalisa has slightly different magnitude estimates.

---

## 5. API Endpoints

| Method | Endpoint | Purpose | Response |
|--------|----------|---------|----------|
| GET | `/` | Health check | `{"message": "..."}` |
| GET | `/earthquakes` | Merged earthquake data | JSON array (cached 60s) |
| GET | `/earthquakes?days=30` | Recent earthquakes only | JSON array (filtered) |
| GET | `/earthquakes_csv` | CSV export of merged data | CSV file download |
| GET | `/volcanoes` | Volcano locations | JSON array |
| GET | `/scrape-volcanoes` | Trigger volcano data refresh | Status message |
| GET | `/shakemap_lookup?dt=...&lat=...&lon=...` | Find ShakeMap for event | ShakeMap URL + metadata |
| GET | `/shakemap/<dt>` | Cached ShakeMap link | ShakeMap record |
| POST | `/reconcile` | Manual reconciliation trigger | Status message |

### 5.1 Caching Strategy

```
Request arrives at /earthquakes
        |
        v
   Is "days=all"?
   /           \
  yes           no
  |              |
  v              v
 Cache hit?    Query DB directly
 (< 60s old)   (no cache for filtered)
 /       \
yes       no
|          |
v          v
Return    Query DB -> cache result -> return
cached    (cache invalidated after each scrape cycle)
```

The default request (no `days` filter) is the most common, so it gets cached. Multiple users hitting the page within a minute share one database query. The cache is invalidated after each scrape cycle so stale data isn't served past the next update.

---

## 6. Volcano Data (`volcano_scraper.py`)

**Data source**: `https://api.vedur.is/epos` (EPOS catalog API)

**Fields extracted**: name, latitude, longitude, elevation (m/ft), description, area

**Update strategy**: Manual trigger only (volcanoes don't change frequently). Called via `GET /scrape-volcanoes`.

---

## 7. ShakeMap Integration

### 7.1 Lookup Flow (`/shakemap_lookup`)

```
Frontend clicks "ShakeMap" button on earthquake popup
        |
        v
GET /shakemap_lookup?dt=<datetime>&lat=<lat>&lon=<lon>
        |
        v
   Check ShakeMapLink cache table
        |
   +----+----+
   |         |
  found    not found
   |         |
   v         v
  Return   Query EPOS ShakeMap API
  cached   (180 min window, 200 km bbox)
             |
             v
          Score candidates by:
           1. Distance from event
           2. Time difference
           3. Magnitude difference
             |
             v
          Return best match (or "not found")
          Cache result in ShakeMapLink table
```

### 7.2 ShakeMap Matching Thresholds

| Parameter | Tolerance | Purpose |
|-----------|-----------|---------|
| Time window | +/- 180 minutes | ShakeMaps may be published hours after event |
| Spatial bbox | +/- 0.3 degrees | Covers ~30 km around epicentre |
| Distance limit | 10 km | ShakeMap epicentre must be near event |
| Time limit | 600 seconds | ShakeMap time must be within 10 minutes |
| Magnitude delta | 0.5 | ShakeMap magnitude (often ML) should be close to Mw |

---

## 8. Haversine Distance Calculation

Used throughout the pipeline for spatial matching (reconciliation + ShakeMap lookup).

```
haversine_km(lat1, lon1, lat2, lon2):

    R = 6371.0 km  (Earth's mean radius)

    a = sin(dlat/2)^2 + cos(lat1) * cos(lat2) * sin(dlon/2)^2

    distance = 2 * R * arcsin(sqrt(a))
```

**Validated by 10 unit tests** including known Iceland reference distances:
- Reykjavik to Akureyri: ~248 km
- Reykjavik to Vik: ~166 km
- Within/outside 10 km threshold boundary tests

---

## 9. Testing

### 9.1 Test Suite (37 tests passing)

| Test File | Count | What It Tests |
|-----------|-------|---------------|
| `test_haversine.py` | 10 | Haversine distance function — zero distance, known distances, threshold behaviour |
| `test_scrape_parse.py` | 14 | HTML parsing — valid/malformed tables, magnitude filtering, edge cases (mocked HTTP) |
| `test_reconcile.py` | 13 | Reconciliation — match/no-match/ambiguous, threshold boundaries, idempotency |

### 9.2 Test Infrastructure

- **Test database**: Temporary file (not production DB)
- **Scheduler**: Disabled via `DISABLE_SCHEDULER` environment variable
- **HTTP mocking**: Responses library patches `requests.get()` for scraper tests
- **Run command**: `cd backend && python -m pytest tests/ -v`

---

## 10. Configuration Summary

| Parameter | Value | Location |
|-----------|-------|----------|
| Backend port | 5001 | `app.py` |
| Database path | `backend/data/earthquakes.db` | `app.py` |
| SQLite mode | WAL + NORMAL sync | `app.py` |
| Scheduler interval | 3 minutes | `app.py` |
| Cache TTL | 60 seconds | `app.py` |
| Magnitude threshold | Mw >= 2.7 | `scrape.py`, `reconcile.py`, `skjalftalisa_client.py` |
| Match distance | < 10 km | `reconcile.py` |
| Match time window | +/- 2 seconds | `reconcile.py` |
| Match magnitude delta | < 3.0 | `reconcile.py` |
| Skjalftalisa rolling window | 7 days | `app.py` |
| Historical start date | 2020-06-01 | `skjalftalisa_client.py` |
| HTTP timeout | 20 seconds | `scrape.py`, `skjalftalisa_client.py` |

---

## 11. File Structure

```
backend/
    app.py                      # Flask API server, models, scheduler, routes
    scrape.py                   # MPGV HTML scraper
    reconcile.py                # Event matching & merging engine
    skjalftalisa_client.py      # Icelandic Met Office API client
    volcano_scraper.py          # EPOS volcano data fetcher
    shakemap_validator.py       # ShakeMap audit & cache tool
    haversine.py                # Haversine distance function (shared)
    data/
        earthquakes.db          # SQLite database (WAL mode)
    tests/
        conftest.py             # Test fixtures (temp DB, disable scheduler)
        test_haversine.py       # Haversine unit tests (10)
        test_scrape_parse.py    # Scraper parsing tests (14)
        test_reconcile.py       # Reconciliation tests (13)
    venv/                       # Python virtual environment
```
