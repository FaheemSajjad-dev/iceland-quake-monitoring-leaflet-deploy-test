from __future__ import annotations

import os
import sys
import logging
import hmac
import threading
import atexit
from pathlib import Path

import csv
import io
import math
import time
import requests

from datetime import datetime, timedelta, timezone
from functools import wraps

CURRENT_FILE_PATH = os.path.dirname(os.path.abspath(__file__))
# Helper modules use ``from app import ...``. When this file is launched
# directly, make that name resolve to the already-running ``__main__`` module
# instead of constructing a second Flask/SQLAlchemy application.
sys.modules.setdefault("app", sys.modules[__name__])

from flask import Flask, jsonify, request, make_response, send_from_directory
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_sqlalchemy import SQLAlchemy
from apscheduler.schedulers.background import BackgroundScheduler
from werkzeug.exceptions import HTTPException
from werkzeug.middleware.proxy_fix import ProxyFix

logging.basicConfig(
    level=getattr(
        logging,
        os.environ.get("LOG_LEVEL", "INFO").strip().upper(),
        logging.INFO,
    ),
    format="%(asctime)s level=%(levelname)s logger=%(name)s message=%(message)s",
)

# Enable gzip if the optional Flask-Compress package is installed.
try:
    from flask_compress import Compress  # pyright: ignore[reportMissingImports]
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
SHAKEMAP_ALLOWED_HOSTS = {
    "api.vedur.is",
    "data.epos-iceland.is",
    "vedur.is",
    "www.vedur.is",
}


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
DB_PATH = str(
    Path(
        os.environ.get("MPGV_DATABASE_PATH", os.path.join(DB_DIR, "earthquakes.db"))
    ).resolve()
)
logging.info("SQLite database path=%s pid=%s", DB_PATH, os.getpid())

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
    source_id = db.Column(db.String, index=True)
    is_current = db.Column(db.Boolean, nullable=False, default=True)
    __table_args__ = (
        db.UniqueConstraint("date_time", "latitude", "longitude", name="unique_earthquake_entry"),
        db.Index(
            "uq_earthquake_current_source_id",
            "source_id",
            unique=True,
            sqlite_where=db.text("is_current = 1 AND source_id IS NOT NULL"),
        ),
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
    v_src_key = db.Column(db.String, unique=True)   # canonical MPGV source identity
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
            earthquake_columns = {
                row[1] for row in conn.execute(db.text("PRAGMA table_info(earthquake)"))
            }
            if "source_id" not in earthquake_columns:
                conn.execute(db.text("ALTER TABLE earthquake ADD COLUMN source_id VARCHAR"))
            if "is_current" not in earthquake_columns:
                conn.execute(
                    db.text(
                        "ALTER TABLE earthquake "
                        "ADD COLUMN is_current BOOLEAN NOT NULL DEFAULT 1"
                    )
                )
            conn.execute(
                db.text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS "
                    "uq_earthquake_current_source_id ON earthquake(source_id) "
                    "WHERE is_current = 1 AND source_id IS NOT NULL"
                )
            )
            conn.execute(
                db.text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS "
                    "uq_earthquake_merged_v_src_key ON earthquake_merged(v_src_key) "
                    "WHERE v_src_key IS NOT NULL"
                )
            )
            conn.commit()

create_tables()

_scheduler = None
_scheduler_lock = threading.Lock()
_scheduler_started = False
_scheduler_owner_lock = None
_bootstrap_lock = threading.Lock()
_bootstrap_started = False
_ingestion_thread_lock = threading.Lock()

# Cache the default /earthquakes response between frontend polling intervals.
_eq_cache: dict = {"data": None, "ts": 0.0}
_EQ_CACHE_TTL = 60


class IngestionBusyError(RuntimeError):
    pass


class IngestionLock:
    def __init__(self, name: str = "ingestion", stale_seconds: int = 1800):
        runtime_dir = Path(os.environ.get("RUNTIME_DIR", Path(CURRENT_FILE_PATH) / "runtime"))
        runtime_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.path = runtime_dir / f"{name}.lock"
        self.stale_seconds = stale_seconds
        self.fd = None

    def __enter__(self):
        if not _ingestion_thread_lock.acquire(blocking=False):
            raise IngestionBusyError("ingestion busy in current process")
        try:
            try:
                self.fd = os.open(
                    str(self.path), os.O_CREAT | os.O_EXCL | os.O_WRONLY
                )
            except FileExistsError:
                owner_pid = _read_lock_pid(self.path)
                if owner_pid is None or _pid_is_alive(owner_pid):
                    raise IngestionBusyError(
                        f"ingestion busy lock={self.path} owner_pid={owner_pid}"
                    )
                logging.warning(
                    "Recovering ingestion lock from dead owner lock=%s owner_pid=%s",
                    self.path,
                    owner_pid,
                )
                self.path.unlink()
                self.fd = os.open(
                    str(self.path), os.O_CREAT | os.O_EXCL | os.O_WRONLY
                )
            os.write(self.fd, f"{os.getpid()}\n".encode("ascii"))
            return self
        except Exception:
            _ingestion_thread_lock.release()
            raise

    def __exit__(self, exc_type, exc, tb):
        try:
            if self.fd is not None:
                os.close(self.fd)
            if _read_lock_pid(self.path) == os.getpid():
                self.path.unlink(missing_ok=True)
        finally:
            _ingestion_thread_lock.release()


def _read_lock_pid(path: Path) -> int | None:
    try:
        value = path.read_text(encoding="ascii").strip()
        pid = int(value)
        return pid if pid > 0 else None
    except (OSError, TypeError, ValueError):
        return None


def _pid_is_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if pid == os.getpid():
        return True
    if os.name == "nt":
        import ctypes

        process = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)
        if not process:
            return False
        ctypes.windll.kernel32.CloseHandle(process)
        return True
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


class SchedulerOwnership:
    """A process-lifetime file lock that elects one scheduler owner."""

    def __init__(self):
        runtime_dir = Path(
            os.environ.get("RUNTIME_DIR", Path(CURRENT_FILE_PATH) / "runtime")
        )
        runtime_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.path = runtime_dir / "scheduler-owner.lock"
        self.fd = None

    def acquire(self) -> bool:
        for _attempt in range(2):
            try:
                self.fd = os.open(
                    str(self.path), os.O_CREAT | os.O_EXCL | os.O_WRONLY
                )
                os.write(self.fd, f"{os.getpid()}\n".encode("ascii"))
                return True
            except FileExistsError:
                owner_pid = _read_lock_pid(self.path)
                if owner_pid is None or _pid_is_alive(owner_pid):
                    logging.info(
                        "Scheduler owner already active lock=%s owner_pid=%s",
                        self.path,
                        owner_pid,
                    )
                    return False
                logging.warning(
                    "Recovering scheduler lock from dead owner lock=%s owner_pid=%s",
                    self.path,
                    owner_pid,
                )
                try:
                    self.path.unlink()
                except FileNotFoundError:
                    pass
        return False

    def release(self) -> None:
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None
        if _read_lock_pid(self.path) == os.getpid():
            self.path.unlink(missing_ok=True)


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
    for date_format in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M:%S.%f"):
        try:
            parsed = datetime.strptime(normalized, date_format)
            return parsed.replace(tzinfo=timezone.utc), None
        except ValueError:
            continue
    return None, _invalid_parameter(name)


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
    import reconcile as _reconcile
    import skjalftalisa_client as _sk
    import volcano_scraper as _volcanoes

    match_and_merge = _reconcile.match_and_merge
    fetch_last_n_days = _sk.fetch_last_n_days
    store_skjalftalisa_rows = _sk.store_skjalftalisa_rows
    refresh_volcanoes = _volcanoes.refresh_volcanoes

    try:
        rows = fetch_last_n_days(7, size_min=3.0)
        store_skjalftalisa_rows(rows)
    except Exception as e:
        logging.warning(
            "Quakes API acquisition failed; reconciling with stored data: %s",
            e,
        )

    try:
        refresh_volcanoes(DB_PATH)
    except Exception as e:
        logging.warning("EPOS volcano refresh failed: %s", e)

    end = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    start = "2020-06-01 00:00:00"
    match_and_merge(start, end, min_mag=3.0)

    _eq_cache["data"] = None


def _catalogue_invariant_summary() -> dict:
    current_source_values = [
        value
        for (value,) in db.session.query(Earthquake.source_id).filter(
            Earthquake.is_current.is_(True),
            Earthquake.mw_mean >= 3.0,
        )
    ]
    current_ids = [value for value in current_source_values if value is not None]
    canonical_rows = EarthquakeMerged.query.all()
    canonical_ids = [row.v_src_key for row in canonical_rows]
    matched = sum(row.status == "matched" for row in canonical_rows)
    v_only = sum(row.status == "v_only" for row in canonical_rows)
    assigned_s_ids = [
        row.s_event_id for row in canonical_rows if row.s_event_id is not None
    ]
    missing = set(current_ids) - set(canonical_ids)
    violations = {
        "missing_current_identities": len(missing)
        + sum(value is None for value in current_source_values),
        "duplicate_canonical_identities": len(canonical_ids)
        - len(set(canonical_ids)),
        "canonical_without_v_src_key": sum(
            value is None for value in canonical_ids
        ),
        "repeated_imo_assignments": len(assigned_s_ids)
        - len(set(assigned_s_ids)),
    }
    current = len(current_source_values)
    canonical = len(canonical_rows)
    if (
        current != canonical
        or canonical != matched + v_only
        or any(violations.values())
    ):
        raise RuntimeError(
            "Canonical catalogue invariant failed "
            f"current={current} canonical={canonical} matched={matched} "
            f"v_only={v_only} violations={violations}"
        )
    return {
        "current": current,
        "canonical": canonical,
        "matched": matched,
        "v_only": v_only,
        "newest_current_identity": max(current_ids, default=None),
        "newest_canonical_identity": max(canonical_ids, default=None),
        **violations,
    }


def scheduled_scrape() -> None:
    """
    Every 3 minutes:
      1) Scrape MPGV (updates Earthquake)
      2) Fetch recent Quakes API data (last 7 days, rolling)
      3) Reconcile (write EarthquakeMerged)
    """
    with app.app_context():
        started_at = time.monotonic()
        started_utc = datetime.now(timezone.utc)
        logging.info(
            "Scheduler ingestion started pid=%s db_path=%s started_utc=%s",
            os.getpid(),
            DB_PATH,
            started_utc.isoformat(),
        )
        try:
            with IngestionLock():
                # Imports stay inside the job so app.py can define models before helpers load.
                import scrape as _scrape
                import reconcile as _reconcile
                import skjalftalisa_client as _sk
                import volcano_scraper as _volcano
                scrape_all_earthquake_data = _scrape.scrape_all_earthquake_data
                match_and_merge = _reconcile.match_and_merge
                fetch_last_n_days = _sk.fetch_last_n_days
                store_skjalftalisa_rows = _sk.store_skjalftalisa_rows
                refresh_volcanoes = _volcano.refresh_volcanoes

                try:
                    mpgv_summary = scrape_all_earthquake_data()
                except Exception:
                    logging.exception(
                        "MPGV acquisition rejected; preserving the previous "
                        "current and canonical catalogues."
                    )
                    return

                quakes_fetched = 0
                quakes_stored = 0
                try:
                    rows = fetch_last_n_days(7, size_min=3.0)
                    quakes_fetched = len(rows)
                    quakes_summary = store_skjalftalisa_rows(rows)
                    quakes_stored = quakes_summary["stored"]
                except Exception as e:
                    logging.warning(
                        "Quakes API acquisition failed; reconciling with stored data: %s",
                        e,
                    )

                end = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
                start = "2020-06-01 00:00:00"
                try:
                    match_and_merge(start, end, min_mag=3.0)
                    invariant = _catalogue_invariant_summary()
                except Exception:
                    logging.exception(
                        "Reconciliation failed; preserving the previous "
                        "canonical catalogue and API cache."
                    )
                    return

                try:
                    refresh_volcanoes(DB_PATH)
                except Exception as e:
                    logging.warning("EPOS volcano refresh failed: %s", e)

                cache_had_value = _eq_cache["data"] is not None
                _eq_cache["data"] = None
                finished_utc = datetime.now(timezone.utc)
                logging.info(
                    "Scheduler ingestion completed started_utc=%s finished_utc=%s "
                    "db_path=%s mpgv_candidate_count=%s new_current_events=%s "
                    "retained_inactive_revisions=%s quakes_fetched=%s "
                    "quakes_stored=%s canonical_total=%s matched_total=%s "
                    "mpgv_only_total=%s newest_current_identity=%s "
                    "newest_canonical_identity=%s cache_invalidated=true "
                    "cache_had_value=%s duration_seconds=%.3f",
                    started_utc.isoformat(),
                    finished_utc.isoformat(),
                    DB_PATH,
                    mpgv_summary["source_current"],
                    mpgv_summary["new_current_events"],
                    mpgv_summary["retained_inactive_revisions"],
                    quakes_fetched,
                    quakes_stored,
                    invariant["canonical"],
                    invariant["matched"],
                    invariant["v_only"],
                    invariant["newest_current_identity"],
                    invariant["newest_canonical_identity"],
                    str(cache_had_value).lower(),
                    time.monotonic() - started_at,
                )
        except IngestionBusyError as exc:
            logging.warning("Scheduler skipped ingestion: %s", exc)


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
            import scrape as _scrape
            _scrape.scrape_all_earthquake_data()

        _refresh_derived_data()


def start_background_services() -> None:
    global _scheduler, _scheduler_started, _scheduler_owner_lock

    if parse_bool(os.environ.get("DISABLE_SCHEDULER")) or _scheduler_started:
        return

    with _scheduler_lock:
        if _scheduler_started:
            return

        owner_lock = SchedulerOwnership()
        if not owner_lock.acquire():
            return

        _scheduler_owner_lock = owner_lock
        _scheduler = BackgroundScheduler(coalesce=True, misfire_grace_time=300)
        _scheduler.add_job(
            scheduled_scrape,
            "interval",
            minutes=3,
            max_instances=1,
            id="mpgv-ingestion",
            replace_existing=True,
        )
        _scheduler.start()
        _scheduler_started = True
        logging.info(
            "Scheduler started pid=%s owner_lock=%s",
            os.getpid(),
            owner_lock.path,
        )


def stop_background_services() -> None:
    global _scheduler, _scheduler_started, _scheduler_owner_lock

    with _scheduler_lock:
        if _scheduler is not None and _scheduler.running:
            _scheduler.shutdown(wait=False)
        _scheduler = None
        _scheduler_started = False
        if _scheduler_owner_lock is not None:
            _scheduler_owner_lock.release()
            _scheduler_owner_lock = None


atexit.register(stop_background_services)


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
                "status":    r.status,
                "mpgv_source_id": r.v_src_key,
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
    start_background_services()
    app.run(debug=False, port=BACKEND_PORT)
