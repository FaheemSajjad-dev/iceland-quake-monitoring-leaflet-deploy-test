from app import EarthquakeMerged


def add_earthquake(db_session, *, dt, magnitude, depth, status):
    db_session.session.add(EarthquakeMerged(
        date_time=dt,
        latitude=64.0,
        longitude=-21.0,
        depth=depth,
        mw_mean=magnitude,
        status=status,
    ))


def test_insights_limits_are_aggregated_by_depth_policy(test_app, db_session):
    add_earthquake(db_session, dt="2024-01-01 00:00:00", magnitude=3.01, depth=2.4, status="matched")
    add_earthquake(db_session, dt="2024-01-02 00:00:00", magnitude=5.83, depth=40.7, status="matched")
    add_earthquake(db_session, dt="2024-01-03 00:00:00", magnitude=4.2, depth=900.0, status="v_only")
    db_session.session.commit()

    client = test_app.test_client()
    matched = client.get("/insights/limits?depth_quality=reference_only")
    assert matched.status_code == 200
    payload = matched.get_json()
    assert payload["depth_quality"] == "reference_only"
    assert payload["magnitude_limits"] == {"minimum": 3.01, "maximum": 5.83}
    assert payload["depth_limits"] == {"minimum": 2.4, "maximum": 40.7}
    assert isinstance(payload["magnitude_limits"]["minimum"], (int, float))
    assert isinstance(payload["magnitude_limits"]["maximum"], (int, float))
    assert isinstance(payload["depth_limits"]["minimum"], (int, float))
    assert isinstance(payload["depth_limits"]["maximum"], (int, float))

    all_depths = client.get("/insights/limits?depth_quality=include_unverified")
    assert all_depths.status_code == 200
    assert all_depths.get_json()["depth_limits"] == {"minimum": 2.4, "maximum": 900.0}


def test_insights_limits_return_null_depths_when_policy_has_none(test_app, db_session):
    add_earthquake(db_session, dt="2024-01-01 00:00:00", magnitude=3.5, depth=8.0, status="v_only")
    db_session.session.commit()

    response = test_app.test_client().get("/insights/limits?depth_quality=reference_only")
    assert response.status_code == 200
    assert response.get_json()["depth_limits"] == {"minimum": None, "maximum": None}


def test_insights_limits_reject_invalid_query_parameters(test_app):
    client = test_app.test_client()
    assert client.get("/insights/limits?depth_quality=bogus").status_code == 400
    assert client.get("/insights/limits?max_magnitude=999").status_code == 400
