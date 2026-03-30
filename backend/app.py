from __future__ import annotations

import os
import sys
import logging
import threading
from pathlib import Path

import csv
import io
import math
import time
import requests

from datetime import datetime, timedelta, timezone

# When the app is launched with a global Python instead of backend/venv,
# make the local virtualenv's site-packages importable as a fallback.
CURRENT_FILE_PATH = os.path.dirname(os.path.abspath(__file__))
LOCAL_VENV = Path(CURRENT_FILE_PATH) / "venv"
if LOCAL_VENV.exists():
    # Windows: Lib/site-packages; Linux: lib/python3.x/site-packages
    venv_site_packages = next(
        (p for p in [*LOCAL_VENV.glob("Lib/site-packages"), *LOCAL_VENV.glob("lib/*/site-packages")] if p.exists()),
        None,
    )
    if venv_site_packages and str(venv_site_packages) not in sys.path:
        sys.path.insert(0, str(venv_site_packages))

from flask import Flask, jsonify, request, make_response, send_from_directory
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from apscheduler.schedulers.background import BackgroundScheduler

# Optional: gzip responses if Flask-Compress is installed
try:
    from flask_compress import Compress  # pip install Flask-Compress
except Exception:  # noqa: BLE001
    Compress = None

FRONTEND_PORT = int(os.environ.get("FRONTEND_PORT", "5176"))
BACKEND_PORT = int(os.environ.get("PORT") or os.environ.get("BACKEND_PORT", "5002"))
FRONTEND_DIST_DIR = (Path(CURRENT_FILE_PATH).parent / "frontend" / "dist").resolve()
FRONTEND_ASSETS_DIR = FRONTEND_DIST_DIR / "assets"

# -----------------------------------------------------------------------------
# App & DB setup
# -----------------------------------------------------------------------------
app = Flask(__name__)

# Restrict CORS to known frontend dev origins. Production is same-origin on Render.
_ALLOWED_ORIGINS = [
    f"http://localhost:{FRONTEND_PORT}",
    f"http://127.0.0.1:{FRONTEND_PORT}",
]
CORS(app, origins=_ALLOWED_ORIGINS)
if Compress:
    Compress(app)

# quiet down apscheduler logs
logging.getLogger("apscheduler").setLevel(logging.WARNING)

DB_DIR = os.path.join(CURRENT_FILE_PATH, "data")
os.makedirs(DB_DIR, exist_ok=True)
DB_PATH = os.path.join(DB_DIR, "earthquakes.db")
print(f"Using database at: {DB_PATH}")

app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{DB_PATH}"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {"connect_args": {"check_same_thread": False}}

db = SQLAlchemy(app)

# Enable faster, safer writes with SQLite WAL mode (when app starts)
with app.app_context():
    try:
        db.session.execute(db.text("PRAGMA journal_mode=WAL;"))
        db.session.execute(db.text("PRAGMA synchronous=NORMAL;"))
        db.session.commit()
    except Exception:
        # non-fatal if PRAGMAs aren't supported in some env
        db.session.rollback()

# -----------------------------------------------------------------------------
# Models
# -----------------------------------------------------------------------------
class Earthquake(db.Model):
    """MPGV source table (v)."""
    id = db.Column(db.Integer, primary_key=True)
    date_time = db.Column(db.String, nullable=False)       # 'YYYY-MM-DD HH:MM:SS' UTC
    latitude = db.Column(db.Float, nullable=False)
    longitude = db.Column(db.Float, nullable=False)
    depth = db.Column(db.Float, nullable=False)
    mw_mean = db.Column(db.Float, nullable=False)
    __table_args__ = (
        db.UniqueConstraint("date_time", "latitude", "longitude", name="unique_earthquake_entry"),
    )


class Volcano(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String, nullable=False)
    description = db.Column(db.Text)
    elevation_m = db.Column(db.Float)
    elevation_ft = db.Column(db.Float)
    latitude = db.Column(db.Float, nullable=False)
    longitude = db.Column(db.Float, nullable=False)
    last_eruption = db.Column(db.String)
    __table_args__ = (
        db.UniqueConstraint("name", "latitude", "longitude", name="unique_volcano_entry"),
    )


class EarthquakeSRaw(db.Model):
    """Skjálftalísa raw table (s)."""
    __tablename__ = "earthquake_s_raw"
    id = db.Column(db.Integer, primary_key=True)
    event_id = db.Column(db.String, unique=True, nullable=False)  # IMO id
    date_time = db.Column(db.String, index=True, nullable=False)  # 'YYYY-MM-DD HH:MM:SS' UTC
    latitude = db.Column(db.Float, nullable=False)
    longitude = db.Column(db.Float, nullable=False)
    depth = db.Column(db.Float)                                   # km
    magnitude = db.Column(db.Float)                                # optional

    def __repr__(self) -> str:
        return f"<SRaw event_id={self.event_id} Mw={self.magnitude} lat={self.latitude} lon={self.longitude}>"


class EarthquakeMerged(db.Model):
    """Display table (merged v⊕s per matching rules)."""
    __tablename__ = "earthquake_merged"
    id = db.Column(db.Integer, primary_key=True)
    date_time = db.Column(db.String, index=True, nullable=False)  # keep MPGV time
    latitude = db.Column(db.Float, nullable=False)                 # from S when matched, else V
    longitude = db.Column(db.Float, nullable=False)
    depth = db.Column(db.Float)                                    # from S when matched, else V
    mw_mean = db.Column(db.Float, nullable=False)                  # from V

    # provenance / diagnostics
    status = db.Column(db.String, nullable=False)   # 'matched' | 'v_only'
    v_src_key = db.Column(db.String)                # optional for diagnostics
    s_event_id = db.Column(db.String)
    match_dt_sec = db.Column(db.Float)
    match_dist_km = db.Column(db.Float)
    match_dm = db.Column(db.Float)

# --- ShakeMap link cache table ---------------------------------------------
class ShakeMapLink(db.Model):
    __tablename__ = "shakemap_links"
    dt = db.Column(db.String, primary_key=True)  # matches EarthquakeMerged.date_time

    url_view_file = db.Column(db.String)
    origin_time   = db.Column(db.String)

    sm_lat  = db.Column(db.Float)
    sm_lon  = db.Column(db.Float)
    sm_mag  = db.Column(db.Float)
    sm_depth= db.Column(db.Float)

    dt_sec  = db.Column(db.Float)   # |Δt| seconds to chosen shakemap
    dist_km = db.Column(db.Float)   # distance to chosen shakemap
    dm      = db.Column(db.Float)   # Mw_v - M_shakemap

    status  = db.Column(db.String)  # "valid" | "no_candidate" | "no_valid" | "error"
    note    = db.Column(db.String)

# -----------------------------------------------------------------------------
# DB init
# -----------------------------------------------------------------------------
def create_tables() -> None:
    with app.app_context():
        db.create_all()

create_tables()

_scheduler = None
_scheduler_lock = threading.Lock()
_scheduler_started = False
_bootstrap_lock = threading.Lock()
_bootstrap_started = False

# Simple in-memory cache for /earthquakes (invalidated after each scrape cycle)
_eq_cache: dict = {"data": None, "ts": 0.0}
_EQ_CACHE_TTL = 60  # seconds — frontend polls every 3 min, so 60s is fine

# -----------------------------------------------------------------------------
# Scheduled job
# -----------------------------------------------------------------------------
def _refresh_derived_data() -> None:
    """Fetch secondary sources and rebuild derived tables."""
    sys.path.append(CURRENT_FILE_PATH)
    import importlib
    import reconcile as _reconcile; importlib.reload(_reconcile)
    import skjalftalisa_client as _sk; importlib.reload(_sk)
    import volcano_scraper as _volcanoes; importlib.reload(_volcanoes)

    match_and_merge = _reconcile.match_and_merge
    fetch_last_n_days = _sk.fetch_last_n_days
    store_skjalftalisa_rows = _sk.store_skjalftalisa_rows
    refresh_volcanoes = _volcanoes.refresh_volcanoes

    try:
        rows = fetch_last_n_days(7, size_min=2.7)
        store_skjalftalisa_rows(rows)
    except Exception as e:
        print(f"[WARN] Skjalftalisa fetch failed: {e}")

    try:
        refresh_volcanoes(DB_PATH)
    except Exception as e:
        print(f"[WARN] Volcano refresh failed: {e}")

    end = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    start = "2020-06-01 00:00:00"
    match_and_merge(start, end, min_mag=2.7)

    _eq_cache["data"] = None


def scheduled_scrape() -> None:
    """
    Every 3 minutes:
      1) Scrape MPGV (updates Earthquake)
      2) Fetch recent Skjálftalísa data (last 7 days, rolling)
      3) Reconcile (write EarthquakeMerged)
    """
    with app.app_context():
        # avoid circular imports
        sys.path.append(CURRENT_FILE_PATH)
        import importlib
        import scrape as _scrape; importlib.reload(_scrape)
        import reconcile as _reconcile; importlib.reload(_reconcile)
        import skjalftalisa_client as _sk; importlib.reload(_sk)
        scrape_all_earthquake_data = _scrape.scrape_all_earthquake_data
        match_and_merge = _reconcile.match_and_merge
        fetch_last_n_days = _sk.fetch_last_n_days
        store_skjalftalisa_rows = _sk.store_skjalftalisa_rows

        # Step 1: scrape MPGV (already filtered at Mw >= 2.7 in scrape.py)
        scrape_all_earthquake_data()

        # Step 2: fetch recent Skjálftalísa events (incremental, last 7 days)
        try:
            rows = fetch_last_n_days(7, size_min=2.7)
            store_skjalftalisa_rows(rows)
        except Exception as e:
            print(f"[WARN] Skjálftalísa fetch failed: {e}")

        # Step 3: reconcile v & s into merged
        end = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        start = "2020-06-01 00:00:00"
        match_and_merge(start, end, min_mag=2.7)

        # Invalidate response cache so next request gets fresh reconciled data
        _eq_cache["data"] = None


def bootstrap_missing_data() -> None:
    """Populate merged and volcano tables on a fresh deployment."""
    global _bootstrap_started

    with _bootstrap_lock:
        if _bootstrap_started:
            return
        _bootstrap_started = True

    with app.app_context():
        if EarthquakeMerged.query.count() > 0 and Volcano.query.count() > 0:
            return

        if Earthquake.query.count() == 0:
            sys.path.append(CURRENT_FILE_PATH)
            import importlib
            import scrape as _scrape; importlib.reload(_scrape)
            _scrape.scrape_all_earthquake_data()

        _refresh_derived_data()

def start_background_services() -> None:
    global _scheduler, _scheduler_started

    if os.environ.get("DISABLE_SCHEDULER") or _scheduler_started:
        return

    with _scheduler_lock:
        if _scheduler_started:
            return

        _scheduler = BackgroundScheduler(coalesce=True, misfire_grace_time=60)
        _scheduler.add_job(scheduled_scrape, "interval", minutes=3, max_instances=1)
        _scheduler.start()
        _scheduler_started = True


@app.before_request
def ensure_background_services() -> None:
    # In debug mode Flask spawns a reloader process and a worker process; WERKZEUG_RUN_MAIN
    # is only set in the worker, so we start the scheduler exactly once (not in the reloader).
    if not app.debug or os.environ.get("WERKZEUG_RUN_MAIN") == "true":
        start_background_services()

# -----------------------------------------------------------------------------
# Routes
# -----------------------------------------------------------------------------
@app.route("/assets/<path:path>", methods=["GET"])
def frontend_assets(path):
    if FRONTEND_ASSETS_DIR.exists():
        return send_from_directory(FRONTEND_ASSETS_DIR, path)
    return jsonify({"message": "Frontend assets are not built yet."}), 404


@app.route("/", defaults={"path": ""}, methods=["GET"])
@app.route("/<path:path>", methods=["GET"])
def home(path: str):
    if path.startswith("earthquakes") or path.startswith("volcanoes") or path.startswith("scrape") or path.startswith("shakemap"):
        return jsonify({"message": "API route not found."}), 404

    requested_file = FRONTEND_DIST_DIR / path
    if path and requested_file.is_file():
        return send_from_directory(FRONTEND_DIST_DIR, path)

    index_file = FRONTEND_DIST_DIR / "index.html"
    if index_file.exists():
        return send_from_directory(FRONTEND_DIST_DIR, "index.html")

    return jsonify({"message": "Iceland Earthquake Monitoring API is running!"})


@app.route("/earthquakes", methods=["GET"])
def get_earthquake_data():
    """
    Returns merged earthquake data.
    - default: ALL data (to preserve existing frontend behavior)
    - optional: ?days=NN to limit to recent window
    - optional: ?days=all explicitly returns all
    Cached for _EQ_CACHE_TTL seconds; cache is also invalidated after each scrape.
    """
    days_param = (request.args.get("days") or "all").strip().lower()

    with app.app_context():
        if EarthquakeMerged.query.count() == 0:
            bootstrap_missing_data()

    # Serve from cache only for the default "all" case
    if days_param == "all":
        now = time.time()
        if _eq_cache["data"] is not None and (now - _eq_cache["ts"]) < _EQ_CACHE_TTL:
            return _eq_cache["data"]

    with app.app_context():
        q = EarthquakeMerged.query

        if days_param != "all":
            try:
                days = int(days_param)
                cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")
                q = q.filter(EarthquakeMerged.date_time >= cutoff)
            except ValueError:
                pass

        rows = q.order_by(EarthquakeMerged.date_time.desc()).all()
        result = jsonify([
            {
                "Date-time": r.date_time,
                "Latitude":  r.latitude,
                "Longitude": r.longitude,
                "Depth":     r.depth,
                "Mw_mean":   r.mw_mean,
                "status":    r.status
            } for r in rows
        ])

        if days_param == "all":
            _eq_cache["data"] = result
            _eq_cache["ts"] = time.time()

        return result

@app.route("/earthquakes_csv", methods=["GET"])
def get_earthquake_data_csv():
    """
    Download merged earthquake data as CSV.

    Mirrors /earthquakes default behaviour:
      - uses EarthquakeMerged (polished, Mw >= 2.7)
      - by default returns ALL data (2020-06-01 → now)
      - optional: ?days=NN to limit to recent window
    """
    days_param = (request.args.get("days") or "all").strip().lower()

    with app.app_context():
        q = EarthquakeMerged.query

        if days_param != "all":
            try:
                days = int(days_param)
                cutoff = (
                    datetime.now(timezone.utc) - timedelta(days=days)
                ).strftime("%Y-%m-%d %H:%M:%S")
                q = q.filter(EarthquakeMerged.date_time >= cutoff)
            except ValueError:
                pass

        rows = q.order_by(EarthquakeMerged.date_time.asc()).all()

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["Date-time", "Latitude", "Longitude", "Depth_km", "Mw_mean", "status"])

        for r in rows:
            writer.writerow([
                r.date_time,
                f"{r.latitude:.4f}" if r.latitude is not None else "",
                f"{r.longitude:.4f}" if r.longitude is not None else "",
                f"{r.depth:.2f}" if r.depth is not None else "",
                f"{r.mw_mean:.2f}" if r.mw_mean is not None else "",
                r.status or "",
            ])

        csv_data = output.getvalue()
        response = make_response(csv_data)
        response.headers["Content-Type"] = "text/csv; charset=utf-8"
        response.headers["Content-Disposition"] = (
            "attachment; filename=iceland_earthquakes_merged.csv"
        )
        return response

@app.route('/scrape-volcanoes', methods=['GET'])
def scrape_volcanoes():
    """Fetch and save live volcano data from EPOS Iceland API (localhost only)."""
    if request.remote_addr not in ("127.0.0.1", "::1"):
        return jsonify({"error": "Forbidden"}), 403
    try:
        sys.path.append(CURRENT_FILE_PATH)
        from volcano_scraper import refresh_volcanoes
        ok = refresh_volcanoes(DB_PATH)
        if ok:
            return jsonify({"message": "EPOS volcanoes fetched and saved.", "source": "epos"})
        return jsonify({"message": "No volcano data was found from EPOS API.", "source": "none"}), 502
    except Exception as e:
        logging.exception("scrape-volcanoes failed")
        return jsonify({"error": "Internal server error"}), 500


@app.route('/volcanoes', methods=['GET'])
def get_volcano_data():
    """Returns volcano data from the database as JSON."""
    with app.app_context():
        if Volcano.query.count() == 0:
            bootstrap_missing_data()
        volcanoes = Volcano.query.all()
        return jsonify([
            {
                "name": v.name,
                "description": v.description,
                "elevation_m": v.elevation_m,
                "elevation_ft": v.elevation_ft,
                "latitude": v.latitude,
                "longitude": v.longitude,
                "last_eruption": v.last_eruption
            }
            for v in volcanoes
        ])


@app.route("/reconcile", methods=["POST"])
def run_reconcile():
    """Manual trigger to rerun the reconcile step (localhost only)."""
    if request.remote_addr not in ("127.0.0.1", "::1"):
        return jsonify({"error": "Forbidden"}), 403
    from reconcile import match_and_merge
    end = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    start = "2020-06-01 00:00:00"
    match_and_merge(start, end, min_mag=2.7)
    return jsonify({"message": "Reconcile completed"}), 200


@app.route("/health", methods=["GET"])
def health():
    """Row counts for each table — quick sanity check."""
    with app.app_context():
        return jsonify({
            "MPGV": Earthquake.query.count(),
            "Skjalftalisa": EarthquakeSRaw.query.count(),
            "Merged": EarthquakeMerged.query.count(),
        })


# --- Simple EPOS shakemap lookup for one event -------------------------------
def _km_distance(lat1, lon1, lat2, lon2):
    # Haversine distance (km) — local copy so this module has no import dependency on reconcile.py
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlat = p2 - p1
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dlon/2)**2
    return 2 * R * math.asin(min(1, math.sqrt(a)))

@app.route("/shakemap_lookup", methods=["GET"])
def shakemap_lookup():
    """
    Query EPOS /seismic/shakemaps around the event time/loc and return a view URL if found.
    Params: dt=YYYY-MM-DD HH:MM:SS, lat=..., lon=...
    """
    dt_str = (request.args.get("dt") or "").strip()
    lat = request.args.get("lat", type=float)
    lon = request.args.get("lon", type=float)
    if not dt_str or lat is None or lon is None:
        return jsonify({"found": False, "reason": "missing parameters"}), 400

    # parse event time (treat as UTC)
    try:
        # support both "YYYY-MM-DD HH:MM:SS" and ISO "YYYY-MM-DDTHH:MM:SS"
        dt_str_norm = dt_str.replace("T", " ")
        evt_dt = datetime.strptime(dt_str_norm[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    except Exception:
        return jsonify({"found": False, "reason": "bad dt format"}), 400

    url = "https://api.vedur.is/epos/seismic/shakemaps"

    try:
        r = requests.get(url, timeout=20)
        r.raise_for_status()
        items = r.json() if isinstance(r.json(), list) else []
    except Exception as e:
        logging.exception("shakemap_lookup fetch failed")
        return jsonify({"found": False, "reason": "upstream fetch error"}), 502

    # pick the closest in time+space with simple thresholds
    best = None
    best_score = 1e18
    for it in items:
        try:
            ot = it.get("origin_time") or ""
            ot_norm = ot.replace("T", " ").replace("Z", "")
            dt = datetime.strptime(ot_norm[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
            dmin = abs((dt - evt_dt).total_seconds()) / 60.0
            dkm = _km_distance(lat, lon, float(it["latitude"]), float(it["longitude"]))
            # combine; time weighs more than distance here
            score = dmin * 3 + dkm
            if score < best_score:
                best_score = score
                best = {**it, "dmin": dmin, "dkm": dkm}
        except Exception:
            continue

    # only accept if reasonably close
    if not best:
        return jsonify({"found": False})
    if best["dmin"] > 180 or best["dkm"] > 200:
        return jsonify({"found": False})

    view_url = (best.get("url_view_file") or "").strip()
    if not view_url:
        return jsonify({"found": False})

    return jsonify({
        "found": True,
        "url": view_url,
        "origin_time": best.get("origin_time"),
        "minutes_diff": round(best["dmin"], 1),
        "distance_km": round(best["dkm"], 1),
    })


# --- Return validated ShakeMap URL for an event -----------------------------
@app.route("/shakemap/<dt>", methods=["GET"])
def shakemap(dt):
    link = db.session.get(ShakeMapLink, dt)
    if not link or link.status != "valid":
        return {"available": False}, 200
    return {
        "available": True,
        "url": link.url_view_file,
        "dt_sec": link.dt_sec,
        "dist_km": link.dist_km,
        "dm": link.dm
    }, 200


# -----------------------------------------------------------------------------
# Entrypoint
# -----------------------------------------------------------------------------
if __name__ == "__main__":
    print(f"Starting server with database at: {DB_PATH}")
    start_background_services()
    app.run(debug=False, port=BACKEND_PORT)
