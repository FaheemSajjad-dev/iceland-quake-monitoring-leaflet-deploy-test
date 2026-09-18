from unittest.mock import Mock

import pytest

import app as app_module
from app import EarthquakeMerged, ShakeMapLink
from shakemap_matching import POLICY_NOTE, select_shakemap
import shakemap_validator

TIME = "2023-11-10 12:00:00.700"
URL = "https://data.epos-iceland.is/exact.jpg"


def product(time=TIME, url=URL, **values):
    return {"origin_time": time, "url_view_file": url, **values}


def lookup(test_app, monkeypatch, products, **params):
    response = Mock(headers={"Content-Type": "application/json"})
    response.json.return_value = products
    monkeypatch.setattr(app_module.requests, "get", Mock(return_value=response))
    return test_app.test_client().get("/shakemap_lookup", query_string={"dt": TIME, **params})


def test_exact_fractional_time_needs_no_coordinates(test_app, monkeypatch):
    result = lookup(test_app, monkeypatch, [product()])
    assert result.json["found"] is True
    assert result.json["dt_sec"] == 0
    assert "distance_km" not in result.json


@pytest.mark.parametrize("other", ["2023-11-10 14:00:00.700", "2023-11-10 12:01:00.700", "2023-11-10 12:00:00.800", "2023-11-10 12:00:00"])
def test_nearby_time_is_not_identity(test_app, monkeypatch, other):
    assert lookup(test_app, monkeypatch, [product(other, latitude=64, longitude=-22)]).json == {
        "found": False, "reason": "no_exact_match",
    }


def test_reviewed_coordinates_cannot_override_exact_time(test_app, monkeypatch):
    result = lookup(test_app, monkeypatch, [
        product(latitude=70, longitude=-30),
        product("2023-11-10 12:01:00.700", "https://data.epos-iceland.is/other.jpg", latitude=64, longitude=-22),
    ], lat=64, lon=-22)
    assert result.json["url"] == URL


@pytest.mark.parametrize("time", ["2023-11-10T12:00:00.7Z", "2023-11-10T13:00:00.700+01:00"])
def test_equivalent_utc_representations_match(test_app, monkeypatch, time):
    assert lookup(test_app, monkeypatch, [product(time)]).json["found"] is True


def test_distinct_products_at_same_time_are_ambiguous(test_app, monkeypatch):
    assert lookup(test_app, monkeypatch, [product(), product(url="https://data.epos-iceland.is/other.jpg")]).json == {
        "found": False, "reason": "ambiguous",
    }


def test_duplicate_rows_for_same_product_are_one_link(test_app, monkeypatch):
    assert lookup(test_app, monkeypatch, [product(), product()]).json["url"] == URL


def test_bad_rows_are_skipped_without_losing_exact_product(test_app, monkeypatch):
    assert lookup(test_app, monkeypatch, [None, {}, product("not-a-date"), product(url="javascript:bad"), product(url="https://data.epos-iceland.is:bad/x"), product()]).json["url"] == URL


def test_unexpected_upstream_shape_is_not_reported_as_missing_product(test_app, monkeypatch):
    assert lookup(test_app, monkeypatch, {"error": "unavailable"}).status_code == 502


def test_original_magnitude_or_coordinates_do_not_become_matching_thresholds():
    selected, _ = select_shakemap([product(mw=3.8, ml_auto=2.5)], TIME, app_module._validate_shakemap_url)
    assert selected["mw"] == 3.8


@pytest.mark.parametrize("note,time,available", [
    (None, TIME, False),
    (POLICY_NOTE, "2023-11-10 14:00:00.700", False),
    (POLICY_NOTE, TIME, True),
])
def test_legacy_cached_associations_are_not_reused(test_app, db_session, note, time, available):
    db_session.session.add(ShakeMapLink(dt=TIME, origin_time=time, status="valid", url_view_file=URL, note=note))
    db_session.session.commit()
    assert test_app.test_client().get(f"/shakemap/{TIME}").json["available"] is available


def test_offline_audit_uses_same_policy_and_clears_stale_metadata(test_app, db_session, monkeypatch, tmp_path):
    db_session.session.add(EarthquakeMerged(date_time=TIME, latitude=70, longitude=-30, mw_mean=3.8, status="matched", v_src_key=TIME))
    db_session.session.add(ShakeMapLink(dt=TIME, status="valid", url_view_file="https://data.epos-iceland.is/old.jpg", dist_km=12, dm=9))
    db_session.session.commit()
    response = Mock(headers={"Content-Type": "application/json"})
    response.json.return_value = [product(mw=3.8, ml_auto=2.1, auto_depth=1.1, latitude=64, longitude=-22)]
    fetch = Mock(return_value=response)
    monkeypatch.setattr(shakemap_validator.requests, "get", fetch)
    monkeypatch.setattr(shakemap_validator, "OUT_DIR", str(tmp_path))
    shakemap_validator.audit_all()
    entry = db_session.session.get(ShakeMapLink, TIME)
    assert (entry.url_view_file, entry.sm_mag, entry.dm, entry.dist_km, entry.note) == (URL, 3.8, 0, None, POLICY_NOTE)
    fetch.assert_called_once()
    assert "params" not in fetch.call_args.kwargs
    response.json.return_value = []
    shakemap_validator.audit_all()
    db_session.session.expire_all()
    assert entry.status == "no_exact_match"
    assert entry.url_view_file is None and entry.sm_mag is None
