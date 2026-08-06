import sqlite3
import importlib
import os
import sys

import pytest
import requests

import app as app_module
import reconcile as rec
import scrape
import skjalftalisa_client
import volcano_scraper
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
        ("dt=2026-01-01T00:00:00.100junk&lat=64&lon=-22", "dt"),
        ("dt=2026-01-01T00:00:00.&lat=64&lon=-22", "dt"),
        ("dt=2026-01-01T00:00:00.1234567&lat=64&lon=-22", "dt"),
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


@pytest.mark.parametrize(
    ("value", "microsecond"),
    [
        ("2026-01-01 00:00:00", 0),
        ("2026-01-01T00:00:00", 0),
        ("2026-01-01 00:00:00.1", 100000),
        ("2026-01-01 00:00:00.100", 100000),
        ("2026-01-01T00:00:00.123456", 123456),
    ],
)
def test_event_datetime_accepts_optional_fractional_seconds(value, microsecond):
    parsed, error = app_module._parse_event_datetime(value)

    assert error is None
    assert parsed.microsecond == microsecond
    assert parsed.tzinfo is not None


def test_shakemap_lookup_accepts_catalogue_milliseconds(test_app, monkeypatch):
    class EmptyShakeMapResponse:
        headers = {"Content-Type": "application/json"}

        @staticmethod
        def raise_for_status():
            return None

        @staticmethod
        def json():
            return []

    monkeypatch.setattr(
        app_module.requests,
        "get",
        lambda *args, **kwargs: EmptyShakeMapResponse(),
    )

    response = test_app.test_client().get(
        "/shakemap_lookup?dt=2024-01-14+04:48:41.100&lat=64.65&lon=-24.213"
    )

    assert response.status_code == 200
    assert response.get_json() == {"found": False}


def test_shakemap_lookup_accepts_official_epos_data_host(test_app, monkeypatch):
    class ShakeMapResponse:
        headers = {"Content-Type": "application/json"}

        @staticmethod
        def raise_for_status():
            return None

        @staticmethod
        def json():
            return [{
                "origin_time": "2026-03-31 07:11:02.000",
                "latitude": 64.669,
                "longitude": -17.387,
                "url_view_file": (
                    "https://data.epos-iceland.is/files/seismic/"
                    "shakemaps/20260331_071102.jpg"
                ),
            }]

    monkeypatch.setattr(
        app_module.requests,
        "get",
        lambda *args, **kwargs: ShakeMapResponse(),
    )

    response = test_app.test_client().get(
        "/shakemap_lookup?dt=2026-03-31+07:11:02.000&lat=64.669&lon=-17.387"
    )

    assert response.status_code == 200
    assert response.get_json() == {
        "found": True,
        "url": (
            "https://data.epos-iceland.is/files/seismic/"
            "shakemaps/20260331_071102.jpg"
        ),
        "origin_time": "2026-03-31 07:11:02.000",
        "minutes_diff": 0.0,
        "distance_km": 0.0,
    }


@pytest.mark.parametrize(
    "url",
    [
        "https://data.epos-iceland.is.evil.example/shakemap.jpg",
        "http://data.epos-iceland.is/shakemap.jpg",
        "https://user@data.epos-iceland.is/shakemap.jpg",
    ],
)
def test_shakemap_url_validation_still_rejects_unsafe_urls(url):
    assert app_module._validate_shakemap_url(url) is None


def test_shakemap_stored_url_validation(test_app, db_session):
    db.session.add(ShakeMapLink(dt="2026-01-01 00:00:00", status="valid", url_view_file="javascript:alert(1)"))
    db.session.commit()

    response = test_app.test_client().get("/shakemap/2026-01-01%2000:00:00")

    assert response.status_code == 200
    assert response.get_json() == {"available": False}


def test_reconcile_rollback_preserves_previous_merged_rows(db_session, monkeypatch):
    db.session.add(EarthquakeMerged(
        date_time="2023-06-15 12:00:00",
        latitude=64,
        longitude=-22,
        depth=5,
        mw_mean=3.5,
        status="v_only",
        v_src_key="2023-06-15 12:00:00",
    ))
    db.session.add(Earthquake(
        date_time="2023-06-15 12:00:00",
        source_id="2023-06-15 12:00:00",
        is_current=True,
        latitude=64,
        longitude=-22,
        depth=5,
        mw_mean=3.5,
    ))
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


def test_scheduler_rejected_acquisition_preserves_canonical_and_cache(
    db_session,
    monkeypatch,
):
    db.session.add(EarthquakeMerged(
        date_time="2026-07-28 16:57:15.100",
        latitude=64.136,
        longitude=-18.600,
        depth=1.1,
        mw_mean=3.0,
        status="v_only",
        v_src_key="2026-07-28 16:57:15.100",
    ))
    db.session.commit()
    sentinel = object()
    app_module._eq_cache["data"] = sentinel
    called = {"quakes": False, "reconcile": False}

    monkeypatch.setattr(app_module, "IngestionLock", _NoopLock)
    monkeypatch.setattr(importlib, "reload", lambda module: module)
    monkeypatch.setattr(
        scrape,
        "scrape_all_earthquake_data",
        lambda: (_ for _ in ()).throw(
            scrape.CatalogueValidationError("partial catalogue")
        ),
    )
    monkeypatch.setattr(
        skjalftalisa_client,
        "fetch_last_n_days",
        lambda *args, **kwargs: called.__setitem__("quakes", True),
    )
    monkeypatch.setattr(
        rec,
        "match_and_merge",
        lambda *args, **kwargs: called.__setitem__("reconcile", True),
    )

    app_module.scheduled_scrape()

    assert EarthquakeMerged.query.count() == 1
    assert app_module._eq_cache["data"] is sentinel
    assert called == {"quakes": False, "reconcile": False}
    app_module._eq_cache["data"] = None


def test_scheduler_reconciliation_failure_preserves_cache(
    db_session,
    monkeypatch,
):
    sentinel = object()
    app_module._eq_cache["data"] = sentinel

    monkeypatch.setattr(app_module, "IngestionLock", _NoopLock)
    monkeypatch.setattr(importlib, "reload", lambda module: module)
    monkeypatch.setattr(scrape, "scrape_all_earthquake_data", lambda: {})
    monkeypatch.setattr(
        skjalftalisa_client, "fetch_last_n_days", lambda *args, **kwargs: []
    )
    monkeypatch.setattr(
        skjalftalisa_client, "store_skjalftalisa_rows", lambda rows: None
    )
    monkeypatch.setattr(
        rec,
        "match_and_merge",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            RuntimeError("forced reconciliation failure")
        ),
    )
    monkeypatch.setattr(volcano_scraper, "refresh_volcanoes", lambda path: True)

    app_module.scheduled_scrape()

    assert app_module._eq_cache["data"] is sentinel
    app_module._eq_cache["data"] = None


def test_scheduler_invalidates_cache_only_after_successful_reconciliation(
    db_session,
    monkeypatch,
):
    sentinel = object()
    app_module._eq_cache["data"] = sentinel
    calls = []

    monkeypatch.setattr(app_module, "IngestionLock", _NoopLock)
    monkeypatch.setattr(importlib, "reload", lambda module: module)
    monkeypatch.setattr(
        scrape,
        "scrape_all_earthquake_data",
        lambda: calls.append("mpgv") or {
            "source_current": 0,
            "new_current_events": 0,
            "retained_inactive_revisions": 0,
        },
    )
    monkeypatch.setattr(
        skjalftalisa_client,
        "fetch_last_n_days",
        lambda *args, **kwargs: calls.append("quakes_fetch") or [],
    )
    monkeypatch.setattr(
        skjalftalisa_client,
        "store_skjalftalisa_rows",
        lambda rows: calls.append("quakes_store") or {"stored": 0},
    )
    monkeypatch.setattr(
        rec,
        "match_and_merge",
        lambda *args, **kwargs: calls.append("reconcile"),
    )
    monkeypatch.setattr(
        volcano_scraper,
        "refresh_volcanoes",
        lambda path: calls.append("volcano"),
    )
    monkeypatch.setattr(
        app_module,
        "_catalogue_invariant_summary",
        lambda: {
            "canonical": 0,
            "matched": 0,
            "v_only": 0,
            "newest_current_identity": None,
            "newest_canonical_identity": None,
        },
    )

    app_module.scheduled_scrape()

    assert calls == [
        "mpgv",
        "quakes_fetch",
        "quakes_store",
        "reconcile",
        "volcano",
    ]
    assert app_module._eq_cache["data"] is None


def test_quakes_failure_still_runs_mpgv_anchored_reconciliation(
    db_session,
    monkeypatch,
):
    calls = []
    monkeypatch.setattr(app_module, "IngestionLock", _NoopLock)
    monkeypatch.setattr(
        scrape,
        "scrape_all_earthquake_data",
        lambda: {
            "source_current": 3,
            "new_current_events": 0,
            "retained_inactive_revisions": 0,
        },
    )
    monkeypatch.setattr(
        skjalftalisa_client,
        "fetch_last_n_days",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            requests.RequestException("offline")
        ),
    )
    monkeypatch.setattr(
        rec,
        "match_and_merge",
        lambda *args, **kwargs: calls.append("reconcile"),
    )
    monkeypatch.setattr(volcano_scraper, "refresh_volcanoes", lambda path: True)
    monkeypatch.setattr(
        app_module,
        "_catalogue_invariant_summary",
        lambda: {
            "canonical": 3,
            "matched": 1,
            "v_only": 2,
            "newest_current_identity": "2026-07-28 16:57:19.100",
            "newest_canonical_identity": "2026-07-28 16:57:19.100",
        },
    )

    app_module.scheduled_scrape()

    assert calls == ["reconcile"]


def test_concurrent_scheduler_attempt_does_not_interrupt_owner(
    tmp_path,
    monkeypatch,
):
    monkeypatch.setenv("RUNTIME_DIR", str(tmp_path))
    monkeypatch.setattr(
        scrape,
        "scrape_all_earthquake_data",
        lambda: pytest.fail("concurrent job entered acquisition"),
    )

    with app_module.IngestionLock():
        app_module.scheduled_scrape()
        lock_path = tmp_path / "ingestion.lock"
        assert lock_path.read_text(encoding="ascii").strip() == str(os.getpid())


def test_earthquakes_endpoint_returns_all_three_july_28_identities(
    test_app,
    db_session,
):
    identities = [
        ("2026-07-28 05:36:37.500", "matched"),
        ("2026-07-28 16:57:15.100", "v_only"),
        ("2026-07-28 16:57:19.100", "v_only"),
    ]
    db.session.add_all([
        EarthquakeMerged(
            date_time=identity,
            latitude=64.0,
            longitude=-18.0,
            depth=2.0,
            mw_mean=3.1,
            status=status,
            v_src_key=identity,
        )
        for identity, status in identities
    ])
    db.session.commit()
    app_module._eq_cache["data"] = None

    response = test_app.test_client().get("/earthquakes")

    assert response.status_code == 200
    assert [
        row["mpgv_source_id"] for row in reversed(response.get_json())
    ] == [identity for identity, _status in identities]
    app_module._eq_cache["data"] = None


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


def test_disable_scheduler_zero_means_enabled(monkeypatch):
    monkeypatch.setenv("DISABLE_SCHEDULER", "0")
    assert app_module.parse_bool(os.environ.get("DISABLE_SCHEDULER")) is False


def test_app_has_one_canonical_module_identity():
    assert sys.modules["app"] is app_module
    assert rec.app is app_module.app
    assert rec.db is app_module.db


def test_ingestion_lock_never_recovers_a_live_owner(tmp_path, monkeypatch):
    monkeypatch.setenv("RUNTIME_DIR", str(tmp_path))
    lock_path = tmp_path / "ingestion.lock"
    lock_path.write_text(f"{os.getpid()}\n", encoding="ascii")

    with pytest.raises(RuntimeError, match=f"owner_pid={os.getpid()}"):
        with app_module.IngestionLock(stale_seconds=0):
            pass

    assert lock_path.read_text(encoding="ascii").strip() == str(os.getpid())


def test_ingestion_lock_recovers_only_after_owner_is_dead(tmp_path, monkeypatch):
    monkeypatch.setenv("RUNTIME_DIR", str(tmp_path))
    lock_path = tmp_path / "ingestion.lock"
    lock_path.write_text("99999999\n", encoding="ascii")
    monkeypatch.setattr(app_module, "_pid_is_alive", lambda pid: False)

    with app_module.IngestionLock(stale_seconds=0):
        assert lock_path.read_text(encoding="ascii").strip() == str(os.getpid())

    assert not lock_path.exists()


def test_scheduler_ownership_allows_only_one_live_process(tmp_path, monkeypatch):
    monkeypatch.setenv("RUNTIME_DIR", str(tmp_path))
    first = app_module.SchedulerOwnership()
    second = app_module.SchedulerOwnership()

    assert first.acquire() is True
    assert second.acquire() is False
    first.release()
    assert second.acquire() is True
    second.release()
