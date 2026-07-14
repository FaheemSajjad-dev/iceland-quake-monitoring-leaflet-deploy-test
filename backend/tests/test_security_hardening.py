import sqlite3

import pytest

import app as app_module
import reconcile as rec
from app import Earthquake, EarthquakeMerged, EarthquakeSRaw, ShakeMapLink, Volcano, db


def test_production_admin_routes_reject_missing_token_even_from_loopback(test_app, monkeypatch):
    monkeypatch.setattr(app_module, "ADMIN_TOKEN", "")
    monkeypatch.setattr(app_module, "IS_DEVELOPMENT", False)
    monkeypatch.setattr(app_module, "ALLOW_DEV_LOCAL_ADMIN", False)

    response = test_app.test_client().post("/reconcile", environ_base={"REMOTE_ADDR": "127.0.0.1"})

    assert response.status_code == 503
    assert response.get_json()["error"] == "Maintenance routes are disabled"


def test_reconcile_requires_x_admin_token_not_query_or_authorization(test_app, monkeypatch):
    monkeypatch.setattr(app_module, "ADMIN_TOKEN", "secret-token")
    monkeypatch.setattr(app_module, "IS_DEVELOPMENT", False)
    monkeypatch.setattr(app_module, "ALLOW_DEV_LOCAL_ADMIN", False)
    monkeypatch.setattr(app_module, "IngestionLock", _NoopLock)
    monkeypatch.setattr("reconcile.match_and_merge", lambda *args, **kwargs: None)

    client = test_app.test_client()

    assert client.post("/reconcile?admin_token=secret-token").status_code == 403
    assert client.post("/reconcile", headers={"Authorization": "Bearer secret-token"}).status_code == 403
    assert client.post("/reconcile", headers={"X-Admin-Token": "wrong"}).status_code == 403
    assert client.post("/reconcile", headers={"X-Admin-Token": "secret-token"}).status_code == 200


def test_scrape_volcanoes_is_post_only_and_authenticated(test_app, monkeypatch):
    monkeypatch.setattr(app_module, "ADMIN_TOKEN", "secret-token")
    monkeypatch.setattr(app_module, "IS_DEVELOPMENT", False)
    monkeypatch.setattr(app_module, "ALLOW_DEV_LOCAL_ADMIN", False)
    monkeypatch.setattr(app_module, "IngestionLock", _NoopLock)
    monkeypatch.setattr("volcano_scraper.refresh_volcanoes", lambda db_path: True)

    client = test_app.test_client()

    assert client.get("/scrape-volcanoes").status_code == 405
    assert client.post("/scrape-volcanoes").status_code == 403
    assert client.post("/scrape-volcanoes", headers={"X-Admin-Token": "secret-token"}).status_code == 200


def test_public_get_routes_do_not_bootstrap(test_app, monkeypatch):
    called = {"bootstrap": False}

    def fail_bootstrap():
        called["bootstrap"] = True
        raise AssertionError("public route bootstrapped data")

    monkeypatch.setattr(app_module, "bootstrap_missing_data", fail_bootstrap)

    client = test_app.test_client()
    assert client.get("/earthquakes").status_code == 200
    assert client.get("/volcanoes").status_code == 200
    assert called["bootstrap"] is False


@pytest.mark.parametrize("value", ["abc", "1.5", "0", "-1", "3651", "true"])
def test_invalid_days_returns_400(test_app, value):
    response = test_app.test_client().get(f"/earthquakes?days={value}")

    assert response.status_code == 400
    assert response.get_json() == {"error": "Invalid parameter: days"}


@pytest.mark.parametrize(
    ("query", "parameter"),
    [
        ("dt=2026-01-01T00:00:00junk&lat=64&lon=-22", "dt"),
        ("dt=2026-01-01T00:00:00&lat=nan&lon=-22", "lat"),
        ("dt=2026-01-01T00:00:00&lat=91&lon=-22", "lat"),
        ("dt=2026-01-01T00:00:00&lat=64&lon=inf", "lon"),
        ("dt=2026-01-01T00:00:00&lat=64&lon=-181", "lon"),
    ],
)
def test_invalid_shakemap_lookup_parameters_return_400(test_app, query, parameter):
    response = test_app.test_client().get(f"/shakemap_lookup?{query}")

    assert response.status_code == 400
    assert response.get_json() == {"error": f"Invalid parameter: {parameter}"}


def test_shakemap_stored_url_validation(test_app, db_session):
    db.session.add(ShakeMapLink(dt="2026-01-01 00:00:00", status="valid", url_view_file="javascript:alert(1)"))
    db.session.commit()

    response = test_app.test_client().get("/shakemap/2026-01-01%2000:00:00")

    assert response.status_code == 200
    assert response.get_json() == {"available": False}


def test_reconcile_rollback_preserves_previous_merged_rows(db_session, monkeypatch):
    db.session.add(EarthquakeMerged(date_time="2023-06-15 12:00:00", latitude=64, longitude=-22, depth=5, mw_mean=3.5, status="v_only"))
    db.session.add(Earthquake(date_time="2023-06-15 12:00:00", latitude=64, longitude=-22, depth=5, mw_mean=3.5))
    db.session.add(EarthquakeSRaw(event_id="s1", date_time="2023-06-15 12:00:01", latitude=64, longitude=-22, depth=5, magnitude=3.5))
    db.session.commit()

    original_add_all = db.session.add_all

    def failing_add_all(rows):
        original_add_all(rows)
        raise RuntimeError("forced failure")

    monkeypatch.setattr(db.session, "add_all", failing_add_all)

    with pytest.raises(RuntimeError):
        rec.match_and_merge("2023-06-15 00:00:00", "2023-06-15 23:59:59", min_mag=3.0)

    rows = EarthquakeMerged.query.all()
    assert len(rows) == 1
    assert rows[0].date_time == "2023-06-15 12:00:00"


def test_volcano_replacement_rollback_preserves_existing_rows(tmp_path, monkeypatch):
    from volcano_scraper import save_volcanoes_to_db

    db_path = tmp_path / "volcano.db"
    conn = sqlite3.connect(db_path)
    conn.execute(
        "CREATE TABLE volcano (id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT, elevation_m FLOAT, "
        "elevation_ft FLOAT, latitude FLOAT, longitude FLOAT, last_eruption TEXT, UNIQUE(name, latitude, longitude))"
    )
    conn.execute(
        "INSERT INTO volcano (name, description, elevation_m, elevation_ft, latitude, longitude, last_eruption) "
        "VALUES ('Existing', '', NULL, NULL, 64, -22, NULL)"
    )
    conn.commit()
    conn.close()

    monkeypatch.setattr("volcano_scraper.MIN_VALID_VOLCANO_ROWS", 1)
    bad_rows = [{"name": "Broken", "latitude": 999, "longitude": -22}]

    with pytest.raises(ValueError):
        save_volcanoes_to_db(bad_rows, str(db_path))

    conn = sqlite3.connect(db_path)
    names = [row[0] for row in conn.execute("SELECT name FROM volcano")]
    conn.close()
    assert names == ["Existing"]


class _NoopLock:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False
