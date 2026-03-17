"""
Pytest configuration for backend tests.

Sets DISABLE_SCHEDULER before importing the Flask app (prevents APScheduler
from starting during tests), then provides fixtures that point the app at a
temporary SQLite file so tests never touch the real database.
"""
import os
import sys
import tempfile
import pytest

# --- Must be set BEFORE importing app.py -----------------------------------
os.environ.setdefault("DISABLE_SCHEDULER", "1")

# Add backend directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Import real Flask app and db after setting DISABLE_SCHEDULER
from app import app as flask_app, db as _db


# ---------------------------------------------------------------------------
# Session-scoped: one temp database for the whole test run
# ---------------------------------------------------------------------------
@pytest.fixture(scope="session")
def test_app():
    """
    Reconfigure Flask to use a temporary SQLite file.

    Flask-SQLAlchemy caches engines in _app_engines[app_object].
    After changing SQLALCHEMY_DATABASE_URI we must clear that inner dict
    so the next db.engine access creates a fresh engine pointing at the
    temp file rather than the real production database.
    """
    db_fd, db_path = tempfile.mkstemp(suffix="_test.db")
    os.close(db_fd)

    flask_app.config.update({
        "TESTING": True,
        "SQLALCHEMY_DATABASE_URI": f"sqlite:///{db_path}",
        # Remove pool_size (invalid for SQLite) and allow cross-thread use
        "SQLALCHEMY_ENGINE_OPTIONS": {
            "connect_args": {"check_same_thread": False},
        },
    })

    # Flask-SQLAlchemy caches engines per app object in _app_engines[app].
    # init_app() is the only way to rebuild engines from the new config, but
    # it guards against double-registration via app.extensions["sqlalchemy"].
    # We remove that sentinel and the old engine entry so init_app re-runs
    # cleanly with the new temp-file URI.
    flask_app.extensions.pop("sqlalchemy", None)
    _db._app_engines.pop(flask_app, None)
    _db.init_app(flask_app)

    with flask_app.app_context():
        _db.create_all()

    yield flask_app

    with flask_app.app_context():
        _db.drop_all()
    try:
        os.unlink(db_path)
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Function-scoped: wipe all rows between tests
# ---------------------------------------------------------------------------
@pytest.fixture()
def db_session(test_app):
    """
    Yields the SQLAlchemy db object inside an active app context.
    After each test all rows are deleted (schema kept), so every test
    starts with an empty database.
    """
    with test_app.app_context():
        yield _db
        _db.session.rollback()
        for table in reversed(_db.metadata.sorted_tables):
            _db.session.execute(table.delete())
        _db.session.commit()
