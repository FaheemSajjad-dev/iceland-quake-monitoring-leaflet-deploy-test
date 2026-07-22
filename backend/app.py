from __future__ import annotations

import os
import sys
import logging
import hmac
import threading
from pathlib import Path

import csv
import io
import math
import time
import requests

from datetime import datetime, timedelta, timezone
from functools import wraps

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
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_sqlalchemy import SQLAlchemy
from apscheduler.schedulers.background import BackgroundScheduler
from werkzeug.exceptions import HTTPException
from werkzeug.middleware.proxy_fix import ProxyFix

# Enable gzip if the optional Flask-Compress package is installed.
try:
    from flask_compress import Compress
except Exception:  # noqa: BLE001
    Compress = None

FRONTEND_PORT = int(os.environ.get("FRONTEND_PORT", "5174"))
BACKEND_PORT = int(os.environ.get("PORT") or os.environ.get("BACKEND_PORT", "5001"))
FRONTEND_DIST_DIR = (Path(CURRENT_FILE_PATH).parent / "frontend" / "dist").resolve()
FRONTEND_ASSETS_DIR = FRONTEND_DIST_DIR / "assets"
MAX_DAYS_WINDOW = int(os.environ.get("MAX_DAYS_WINDOW", "3650"))
EARTHQUAKES_MAX_ROWS = int(os.environ.get("EARTHQUAKES_MAX_ROWS", "20000"))
CSV_MAX_DAYS_WINDOW = int(os.environ.get("CSV_MAX_DAYS_WINDOW", "3650"))
CSV_MAX_ROWS = int(os.environ.get("CSV_MAX_ROWS", "50000"))
REQUEST_TIMEOUT = (5, 20)
SHAKEMAP_ALLOWED_HOSTS = {"api.vedur.is", "vedur.is", "www.vedur.is"}


def parse_bool(value: str | None, default: bool = False) -> bool:
    if value is None or value == "":
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


APP_ENV = os.environ.get("APP_ENV", os.environ.get("FLASK_ENV", "production")).strip().lower()
IS_DEVELOPMENT = APP_ENV in {"development", "dev", "local", "test"}

app = Flask(__name__)

TRUSTED_PROXY_COUNT = int(os.environ.get("TRUSTED_PROXY_COUNT", "0"))
if TRUSTED_PROXY_COUNT:
    if TRUSTED_PROXY_COUNT != 1:
        raise RuntimeError("TRUSTED_PROXY_COUNT must be 0 or 1 for the supported topology.")
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)

# Restrict CORS to known development origins; Pluto serves the frontend and API same-origin.
_ALLOWED_ORIGINS = [
    f"http://localhost:{FRONTEND_PORT}",
    f"http://127.0.0.1:{FRONTEND_PORT}",
]
# CORS is applied explicitly in add_security_headers so localhost and
# 127.0.0.1 are reflected exactly for local development.
if Compress:
    Compress(app)

app.config["RATELIMIT_ENABLED"] = os.environ.get("RATE_LIMIT_ENABLED", "true").lower() not in {"0", "false", "no"}
app.config["RATELIMIT_HEADERS_ENABLED"] = True
limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=[os.environ.get("RATE_LIMIT_DEFAULT", "300 per minute")],
    storage_uri=os.environ.get("RATE_LIMIT_STORAGE", "memory://"),
)


def rate_limit(name: str, fallback: str) -> str:
    env_name = f"RATE_LIMIT_{name}"
    return os.environ.get(env_name, fallback)


SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' blob: 'wasm-unsafe-eval'; "
        "worker-src blob:; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob: https://server.arcgisonline.com https://services.arcgisonline.com https://basemaps.arcgis.com https://www.arcgis.com https://tiles.openfreemap.org https://*.basemaps.cartocdn.com https://luk.vedur.is https://geo.vedur.is https://maps.europe-geology.eu; "
        "connect-src 'self' https://server.arcgisonline.com https://services.arcgisonline.com https://basemaps.arcgis.com https://www.arcgis.com https://tiles.openfreemap.org https://luk.vedur.is https://geo.vedur.is https://maps.europe-geology.eu; "
        "font-src 'self' https://tiles.openfreemap.org; "
        "frame-ancestors 'none'; "
        "base-uri 'self'; "
        "form-action 'self'"
    ),
    "Permissions-Policy": (
        "camera=(), microphone=(), payment=(), usb=(), "
        "browsing-topics=(), geolocation=(self)"
    ),
}


@app.after_request
def add_security_headers(response):
    for header, value in SECURITY_HEADERS.items():
        response.headers.setdefault(header, value)

    origin = request.headers.get("Origin")
    if origin in _ALLOWED_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
        response.headers.setdefault("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        requested_headers = request.headers.get("Access-Control-Request-Headers")
        if requested_headers:
            response.headers["Access-Control-Allow-Headers"] = requested_headers

    return response

logging.getLogger("apscheduler").setLevel(logging.WARNING)

ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "").strip()
_LOCAL_ADMIN_ADDRS = {"127.0.0.1", "::1", "localhost"}
ALLOW_DEV_LOCAL_ADMIN = parse_bool(os.environ.get("ALLOW_DEV_LOCAL_ADMIN"), default=IS_DEVELOPMENT)

if ADMIN_TOKEN:
    logging.info("Maintenance routes require X-Admin-Token.")
else:
    logging.warning("ADMIN_TOKEN is not configured; production maintenance routes are disabled.")

def _request_admin_token() -> str:
    return request.headers.get("X-Admin-Token", "").strip()

def _admin_failure_response():
    if not ADMIN_TOKEN and not (IS_DEVELOPMENT and ALLOW_DEV_LOCAL_ADMIN):
        logging.warning("Rejected maintenance request: admin token is not configured.")
        return jsonify({"error": "Maintenance routes are disabled"}), 503
    logging.warning(
        "Rejected maintenance request: invalid credentials from %s to %s",
        request.remote_addr,
        request.path,
    )
    return jsonify({"error": "Forbidden"}), 403


def _is_admin_request() -> bool:
    if ADMIN_TOKEN:
        token = _request_admin_token()
        return bool(token) and hmac.compare_digest(token, ADMIN_TOKEN)
    return IS_DEVELOPMENT and ALLOW_DEV_LOCAL_ADMIN and request.remote_addr in _LOCAL_ADMIN_ADDRS


def require_admin(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        if not _is_admin_request():
            return _admin_failure_response()
        return func(*args, **kwargs)
    return wrapper

DB_DIR = os.path.join(CURRENT_FILE_PATH, "data")
os.makedirs(DB_DIR, exist_ok=True)
DB_PATH = os.path.join(DB_DIR, "earthquakes.db")
logging.info("Using configured SQLite database.")

app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{DB_PATH}"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {"connect_args": {"check_same_thread": False}}

db = SQLAlchemy(app)

# Improve SQLite write behavior for the scheduler/API mix.
with app.app_context():
    try:
        db.session.execute(db.text("PRAGMA journal_mode=WAL;"))
        db.session.execute(db.text("PRAGMA synchronous=NORMAL;"))
        db.session.commit()
    except Exception:
        db.session.rollback()

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
    """EPOS Iceland volcano metadata."""
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
    """Raw IMO Quakes API table (s)."""
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
    """Display table built by matching MPGV rows with Quakes API rows."""
    __tablename__ = "earthquake_merged"
    id = db.Column(db.Integer, primary_key=True)
    date_time = db.Column(db.String, index=True, nullable=False)  # keep MPGV time
    latitude = db.Column(db.Float, nullable=False)                 # from S when matched, else V
    longitude = db.Column(db.Float, nullable=False)
    depth = db.Column(db.Float)                                    # from S when matched, else V
    mw_mean = db.Column(db.Float, nullable=False)                  # from V

    # Match provenance for auditing and CSV/API diagnostics.
    status = db.Column(db.String, nullable=False)   # 'matched' | 'v_only'
    v_src_key = db.Column(db.String)                # optional for diagnostics
    s_event_id = db.Column(db.String)
    match_dt_sec = db.Column(db.Float)
    match_dist_km = db.Column(db.Float)
    match_dm = db.Column(db.Float)

class ShakeMapLink(db.Model):
    __tablename__ = "shakemap_links"
    dt = db.Column(db.String, primary_key=True)  # matches EarthquakeMerged.date_time

    url_view_file = db.Column(db.String)
    origin_time   = db.Column(db.String)

    sm_lat  = db.Column(db.Float)
    sm_lon  = db.Column(db.Float)
    sm_mag  = db.Column(db.Float)
    sm_depth= db.Column(db.Float)

    dt_sec  = db.Column(db.Float)   # time difference in seconds to chosen ShakeMap
    dist_km = db.Column(db.Float)   # distance to chosen shakemap
    dm      = db.Column(db.Float)   # Mw_v - M_shakemap

    status  = db.Column(db.String)  # "valid" | "no_candidate" | "no_valid" | "error"
    note    = db.Column(db.String)

def create_tables() -> None:
    with app.app_context():
        db.create_all()
        # Schema migration: add columns that were added after initial table creation.
        # db.create_all() does not ALTER existing tables, so we handle it here.
        with db.engine.connect() as conn:
            existing = {row[1] for row in conn.execute(db.text("PRAGMA table_info(volcano)"))}
            if "last_eruption" not in existing:
                conn.execute(db.text("ALTER TABLE volcano ADD COLUMN last_eruption TEXT"))
                conn.commit()

create_tables()

_scheduler = None
_scheduler_lock = threading.Lock()
_scheduler_started = False
_bootstrap_lock = threading.Lock()
_bootstrap_started = False
_ingestion_thread_lock = threading.Lock()

# Cache the default /earthquakes response between frontend polling intervals.
_eq_cache: dict = {"data": None, "ts": 0.0}
_EQ_CACHE_TTL = 60


class IngestionLock:
    def __init__(self, name: str = "ingestion", stale_seconds: int = 1800):
        runtime_dir = Path(os.environ.get("RUNTIME_DIR", Path(CURRENT_FILE_PATH) / "runtime"))
        runtime_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.path = runtime_dir / f"{name}.lock"
        self.stale_seconds = stale_seconds
        self.fd = None

    def __enter__(self):
        if not _ingestion_thread_lock.acquire(blocking=False):
            raise RuntimeError("ingestion busy")
        try:
            now = time.time()
            if self.path.exists() and now - self.path.stat().st_mtime > self.stale_seconds:
                self.path.unlink(missing_ok=True)
            self.fd = os.open(str(self.path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(self.fd, f"{os.getpid()}\n".encode("ascii"))
            return self
        except Exception:
            _ingestion_thread_lock.release()
            raise

    def __exit__(self, exc_type, exc, tb):
        try:
            if self.fd is not None:
                os.close(self.fd)
            self.path.unlink(missing_ok=True)
        finally:
            _ingestion_thread_lock.release()


def _invalid_parameter(name: str):
    logging.info("Rejected invalid parameter: %s", name)
    return jsonify({"error": f"Invalid parameter: {name}"}), 400


def _parse_days_param(name: str = "days", *, allow_all: bool = True, max_days: int = MAX_DAYS_WINDOW):
    raw = request.args.get(name)
    if raw is None or raw == "":
        return None if allow_all else _invalid_parameter(name)
    raw = raw.strip()
    if allow_all and raw.lower() == "all":
        return None
    if len(raw) > 5 or not raw.isdecimal():
        return _invalid_parameter(name)
    days = int(raw)
    if days < 1 or days > max_days:
        return _invalid_parameter(name)
    return days


def _parse_float_param(name: str, min_value: float, max_value: float):
    raw = request.args.get(name, "")
    if len(raw) > 32:
        return None, _invalid_parameter(name)
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None, _invalid_parameter(name)
    if not math.isfinite(value) or value < min_value or value > max_value:
        return None, _invalid_parameter(name)
    return value, None


def _parse_event_datetime(value: str, name: str = "dt"):
    if not value or len(value) > 32:
        return None, _invalid_parameter(name)
    normalized = value.replace("T", " ")
    try:
        parsed = datetime.strptime(normalized, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    except ValueError:
        return None, _invalid_parameter(name)
    return parsed, None


def _validate_shakemap_url(url: str) -> str | None:
    from urllib.parse import urlparse

    if not url or len(url) > 2048:
        return None
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.username or parsed.password:
        return None
    if parsed.hostname not in SHAKEMAP_ALLOWED_HOSTS:
        logging.info("Rejected ShakeMap URL host: %s", parsed.hostname)
        return None
    if parsed.port not in (None, 443):
        return None
    return url


@app.errorhandler(HTTPException)
def handle_http_error(error):
    payload = {"error": error.name}
    response = jsonify(payload)
    response.status_code = error.code or 500
    if error.code == 429 and getattr(error, "retry_after", None):
        response.headers["Retry-After"] = str(error.retry_after)
    return response

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
        rows = fetch_last_n_days(7, size_min=3.0)
        store_skjalftalisa_rows(rows)
    except Exception as e:
        print(f"Quakes API fetch failed: {e}")

    try:
        refresh_volcanoes(DB_PATH)
    except Exception as e:
        print(f"Volcano refresh failed: {e}")

    end = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    start = "2020-06-01 00:00:00"
    match_and_merge(start, end, min_mag=3.0)

    _eq_cache["data"] = None


def scheduled_scrape() -> None:
    """
    Every 3 minutes:
      1) Scrape MPGV (updates Earthquake)
      2) Fetch recent Quakes API data (last 7 days, rolling)
      3) Reconcile (write EarthquakeMerged)
    """
    with app.app_context():
        try:
            with IngestionLock():
                # Imports stay inside the job so app.py can define models before helpers load.
                sys.path.append(CURRENT_FILE_PATH)
                import importlib
                import scrape as _scrape; importlib.reload(_scrape)
                import reconcile as _reconcile; importlib.reload(_reconcile)
                import skjalftalisa_client as _sk; importlib.reload(_sk)
                import volcano_scraper as _volcano; importlib.reload(_volcano)
                scrape_all_earthquake_data = _scrape.scrape_all_earthquake_data
                match_and_merge = _reconcile.match_and_merge
                fetch_last_n_days = _sk.fetch_last_n_days
                store_skjalftalisa_rows = _sk.store_skjalftalisa_rows
                refresh_volcanoes = _volcano.refresh_volcanoes

                scrape_all_earthquake_data()

                try:
                    rows = fetch_last_n_days(7, size_min=3.0)
                    store_skjalftalisa_rows(rows)
                except Exception as e:
                    print(f"Quakes API fetch failed: {e}")

                end = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
                start = "2020-06-01 00:00:00"
                match_and_merge(start, end, min_mag=3.0)

                try:
                    refresh_volcanoes(DB_PATH)
                except Exception as e:
                    print(f"EPOS volcano refresh failed: {e}")

                _eq_cache["data"] = None
        except RuntimeError:
            logging.warning("Scheduler skipped ingestion because another writer is active.")


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

@app.route("/assets/<path:path>", methods=["GET"])
@limiter.exempt
def frontend_assets(path):
    if FRONTEND_ASSETS_DIR.exists():
        return send_from_directory(FRONTEND_ASSETS_DIR, path)
    return jsonify({"message": "Frontend assets are not built yet."}), 404


@app.route("/", defaults={"path": ""}, methods=["GET"])
@app.route("/<path:path>", methods=["GET"])
@limiter.exempt
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
@limiter.limit(lambda: rate_limit("EARTHQUAKES", "120 per minute"))
def get_earthquake_data():
    """Return merged earthquake data. Optional ?days=NN limits to recent window."""
    days = _parse_days_param(max_days=MAX_DAYS_WINDOW)
    if not isinstance(days, int) and days is not None:
        return days

    if days is None:
        now = time.time()
        if _eq_cache["data"] is not None and (now - _eq_cache["ts"]) < _EQ_CACHE_TTL:
            return _eq_cache["data"]

    with app.app_context():
        q = EarthquakeMerged.query.filter(EarthquakeMerged.mw_mean >= 3.0)

        if days is not None:
            cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")
            q = q.filter(EarthquakeMerged.date_time >= cutoff)

        if q.count() > EARTHQUAKES_MAX_ROWS:
            return jsonify({"error": "Result set too large"}), 413

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

        if days is None:
            _eq_cache["data"] = result
            _eq_cache["ts"] = time.time()

        return result


@app.route("/insights/limits", methods=["GET"])
@limiter.limit(lambda: rate_limit("EARTHQUAKES", "120 per minute"))
def get_insights_limits():
    """Return catalogue magnitude and policy-eligible depth aggregates."""
    allowed_params = {"depth_quality"}
    unexpected = set(request.args) - allowed_params
    if unexpected:
        return jsonify({"error": "Unsupported query parameter"}), 400

    depth_quality = request.args.get("depth_quality", "reference_only")
    if depth_quality not in {"reference_only", "include_unverified"}:
        return jsonify({"error": "Invalid depth_quality"}), 400

    catalogue = EarthquakeMerged.query.filter(EarthquakeMerged.mw_mean >= 3.0)
    magnitude_min, magnitude_max = catalogue.with_entities(
        db.func.min(EarthquakeMerged.mw_mean),
        db.func.max(EarthquakeMerged.mw_mean),
    ).one()

    eligible_depths = catalogue.filter(EarthquakeMerged.depth.isnot(None))
    if depth_quality == "reference_only":
        eligible_depths = eligible_depths.filter(
            EarthquakeMerged.status == "matched"
        )
    depth_min, depth_max = eligible_depths.with_entities(
        db.func.min(EarthquakeMerged.depth),
        db.func.max(EarthquakeMerged.depth),
    ).one()

    return jsonify({
        "depth_quality": depth_quality,
        "magnitude_limits": {
            "minimum": magnitude_min,
            "maximum": magnitude_max,
        },
        "depth_limits": {
            "minimum": depth_min,
            "maximum": depth_max,
        },
    })

@app.route("/earthquakes_csv", methods=["GET"])
@limiter.limit(lambda: rate_limit("CSV", "10 per minute"))
def get_earthquake_data_csv():
    """Download merged earthquake data as CSV. Optional ?days=NN limits the window."""
    days = _parse_days_param(max_days=CSV_MAX_DAYS_WINDOW)
    if not isinstance(days, int) and days is not None:
        return days

    with app.app_context():
        q = EarthquakeMerged.query.filter(EarthquakeMerged.mw_mean >= 3.0)

        if days is not None:
            cutoff = (
                datetime.now(timezone.utc) - timedelta(days=days)
            ).strftime("%Y-%m-%d %H:%M:%S")
            q = q.filter(EarthquakeMerged.date_time >= cutoff)

        if q.count() > CSV_MAX_ROWS:
            return jsonify({"error": "Result set too large"}), 413

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

@app.route('/scrape-volcanoes', methods=['POST'])
@limiter.limit(lambda: rate_limit("ADMIN", "5 per minute"))
@require_admin
def scrape_volcanoes():
    """Fetch and save live volcano data from EPOS Iceland API (admin only)."""
    try:
        sys.path.append(CURRENT_FILE_PATH)
        from volcano_scraper import refresh_volcanoes
        with IngestionLock():
            ok = refresh_volcanoes(DB_PATH)
        if ok:
            return jsonify({"message": "EPOS volcanoes fetched and saved.", "source": "epos"})
        return jsonify({"message": "No volcano data was found from EPOS API.", "source": "none"}), 502
    except RuntimeError:
        logging.warning("Rejected scrape-volcanoes request because ingestion lock is busy.")
        return jsonify({"error": "Ingestion is already running"}), 409
    except Exception as e:
        logging.exception("scrape-volcanoes failed")
        return jsonify({"error": "Internal server error"}), 500


@app.route('/scrape-volcanoes', methods=['GET'])
def scrape_volcanoes_get_not_allowed():
    return jsonify({"error": "Method Not Allowed"}), 405


@app.route('/volcanoes', methods=['GET'])
@limiter.limit(lambda: rate_limit("VOLCANOES", "120 per minute"))
def get_volcano_data():
    """Returns volcano data from the database as JSON."""
    with app.app_context():
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
@limiter.limit(lambda: rate_limit("ADMIN", "5 per minute"))
@require_admin
def run_reconcile():
    """Manual trigger to rerun the reconcile step (admin only)."""
    from reconcile import match_and_merge
    end = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    start = "2020-06-01 00:00:00"
    try:
        with IngestionLock():
            match_and_merge(start, end, min_mag=3.0)
    except RuntimeError:
        logging.warning("Rejected reconcile request because ingestion lock is busy.")
        return jsonify({"error": "Ingestion is already running"}), 409
    return jsonify({"message": "Reconcile completed"}), 200


@app.route("/initialize-data", methods=["POST"])
@limiter.limit(lambda: rate_limit("ADMIN", "3 per hour"))
@require_admin
def initialize_data():
    """Protected initial data load for fresh deployments."""
    try:
        with IngestionLock():
            bootstrap_missing_data()
    except RuntimeError:
        logging.warning("Rejected initialize-data request because ingestion lock is busy.")
        return jsonify({"error": "Ingestion is already running"}), 409
    return jsonify({"message": "Initialization completed"}), 200


@app.route("/health", methods=["GET"])
@limiter.exempt
def health():
    """Row counts for each table; useful for quick deployment sanity checks."""
    with app.app_context():
        return jsonify({
            "MPGV": Earthquake.query.count(),
            "QuakesAPI": EarthquakeSRaw.query.count(),
            "Merged": EarthquakeMerged.query.count(),
        })


def _km_distance(lat1, lon1, lat2, lon2):
    # Local copy keeps ShakeMap lookup independent from reconcile.py imports.
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlat = p2 - p1
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dlon/2)**2
    return 2 * R * math.asin(min(1, math.sqrt(a)))

@app.route("/shakemap_lookup", methods=["GET"])
@limiter.limit(lambda: rate_limit("SHAKEMAP", "60 per minute"))
def shakemap_lookup():
    """Query EPOS shakemaps near an event. Params: dt, lat, lon."""
    dt_str = (request.args.get("dt") or "").strip()
    evt_dt, error = _parse_event_datetime(dt_str)
    if error:
        return error
    lat, error = _parse_float_param("lat", -90.0, 90.0)
    if error:
        return error
    lon, error = _parse_float_param("lon", -180.0, 180.0)
    if error:
        return error

    url = "https://api.vedur.is/epos/seismic/shakemaps"

    try:
        r = requests.get(url, timeout=REQUEST_TIMEOUT, allow_redirects=False)
        r.raise_for_status()
        if "json" not in r.headers.get("Content-Type", "").lower():
            return jsonify({"found": False, "reason": "upstream content type error"}), 502
        items = r.json() if isinstance(r.json(), list) else []
    except Exception as e:
        logging.exception("shakemap_lookup fetch failed")
        return jsonify({"found": False, "reason": "upstream fetch error"}), 502

    best = None
    best_score = 1e18
    for it in items:
        try:
            ot = it.get("origin_time") or ""
            ot_norm = ot.replace("T", " ").replace("Z", "")
            dt = datetime.strptime(ot_norm[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
            dmin = abs((dt - evt_dt).total_seconds()) / 60.0
            dkm = _km_distance(lat, lon, float(it["latitude"]), float(it["longitude"]))
            score = dmin * 3 + dkm
            if score < best_score:
                best_score = score
                best = {**it, "dmin": dmin, "dkm": dkm}
        except Exception:
            continue

    if not best:
        return jsonify({"found": False})
    if best["dmin"] > 180 or best["dkm"] > 200:
        return jsonify({"found": False})

    view_url = (best.get("url_view_file") or "").strip()
    view_url = _validate_shakemap_url(view_url)
    if not view_url:
        return jsonify({"found": False})

    return jsonify({
        "found": True,
        "url": view_url,
        "origin_time": best.get("origin_time"),
        "minutes_diff": round(best["dmin"], 1),
        "distance_km": round(best["dkm"], 1),
    })


@app.route("/shakemap/<dt>", methods=["GET"])
@limiter.limit(lambda: rate_limit("SHAKEMAP", "60 per minute"))
def shakemap(dt):
    _, error = _parse_event_datetime(dt)
    if error:
        return error
    link = db.session.get(ShakeMapLink, dt)
    if not link or link.status != "valid":
        return {"available": False}, 200
    url = _validate_shakemap_url(link.url_view_file or "")
    if not url:
        return {"available": False}, 200
    return {
        "available": True,
        "url": url,
        "dt_sec": link.dt_sec,
        "dist_km": link.dist_km,
        "dm": link.dm
    }, 200


if __name__ == "__main__":
    print(f"Starting server with database at: {DB_PATH}")
    start_background_services()
    app.run(debug=False, port=BACKEND_PORT)
