"""
Integration tests for reconcile.match_and_merge().

Each test inserts controlled rows into the temp database, calls
match_and_merge(), then asserts the correct rows appear in earthquake_merged.

Thresholds (from reconcile.py):
    DIST_LIMIT_KM = 10.0   → distance between V and S must be < 10 km
    DM_LIMIT      = 3.0    → |mw_v - mag_s| must be < 3.0
    Time window   = ±2 s   → |Δt| must be <= 2 seconds to be a candidate
"""
import pytest
import reconcile as rec
from app import db, Earthquake, EarthquakeSRaw, EarthquakeMerged


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
START = "2023-06-15 00:00:00"
END   = "2023-06-15 23:59:59"

def add_v(dt="2023-06-15 12:00:00", lat=64.0, lon=-22.0, depth=5.0, mw=3.5):
    """Insert one MPGV (V) event and return it."""
    v = Earthquake(date_time=dt, latitude=lat, longitude=lon, depth=depth, mw_mean=mw)
    db.session.add(v)
    db.session.commit()
    return v

def add_s(event_id, dt="2023-06-15 12:00:01", lat=64.005, lon=-22.005, depth=6.0, mag=3.4):
    """Insert one Skjálftalísa (S) event and return it."""
    s = EarthquakeSRaw(event_id=event_id, date_time=dt, latitude=lat,
                       longitude=lon, depth=depth, magnitude=mag)
    db.session.add(s)
    db.session.commit()
    return s

def run_merge():
    """Shorthand: run match_and_merge over the test day window."""
    rec.match_and_merge(START, END, min_mag=3.0)

def merged_rows():
    """Return all EarthquakeMerged rows."""
    return EarthquakeMerged.query.all()


# ---------------------------------------------------------------------------
# 1. No S events → v_only
# ---------------------------------------------------------------------------
def test_v_only_when_no_s_events(db_session):
    add_v()
    run_merge()
    rows = merged_rows()
    assert len(rows) == 1
    assert rows[0].status == "v_only"


# ---------------------------------------------------------------------------
# 2. Perfect match within all thresholds → status='matched', coords from S
# ---------------------------------------------------------------------------
def test_matched_within_all_thresholds(db_session):
    # V at (64.0, -22.0), S at (64.005, -22.005) ≈ 0.7 km, Δt=1 s, Δm=0.1
    add_v(lat=64.0, lon=-22.0, mw=3.5)
    add_s("s001", dt="2023-06-15 12:00:01", lat=64.005, lon=-22.005, mag=3.4)
    run_merge()
    rows = merged_rows()
    assert len(rows) == 1
    r = rows[0]
    assert r.status == "matched"
    assert r.s_event_id == "s001"
    # Coordinates should come from S
    assert abs(r.latitude  - 64.005) < 1e-6
    assert abs(r.longitude - (-22.005)) < 1e-6
    # Mw should come from V
    assert abs(r.mw_mean - 3.5) < 1e-6


# ---------------------------------------------------------------------------
# 3. S too far away (> 10 km) → v_only
# ---------------------------------------------------------------------------
def test_v_only_distance_exceeds_threshold(db_session):
    add_v(lat=64.0, lon=-22.0, mw=3.5)
    # ~55 km north of V
    add_s("s002", dt="2023-06-15 12:00:01", lat=64.5, lon=-22.0, mag=3.4)
    run_merge()
    rows = merged_rows()
    assert len(rows) == 1
    assert rows[0].status == "v_only"


# ---------------------------------------------------------------------------
# 4. S too far in time (3 s outside ±2 s window) → v_only
# ---------------------------------------------------------------------------
def test_v_only_time_outside_window(db_session):
    add_v(dt="2023-06-15 12:00:00")
    # 3 seconds later → not in the ±2 s bucket list
    add_s("s003", dt="2023-06-15 12:00:03", lat=64.005, lon=-22.005, mag=3.4)
    run_merge()
    rows = merged_rows()
    assert len(rows) == 1
    assert rows[0].status == "v_only"


# ---------------------------------------------------------------------------
# 5. Magnitude difference too large (≥ 3.0) → v_only
# ---------------------------------------------------------------------------
def test_v_only_magnitude_diff_too_large(db_session):
    add_v(mw=3.5)
    # Δm = |3.5 - 7.0| = 3.5 ≥ 3.0
    add_s("s004", dt="2023-06-15 12:00:01", lat=64.005, lon=-22.005, mag=7.0)
    run_merge()
    rows = merged_rows()
    assert len(rows) == 1
    assert rows[0].status == "v_only"


# ---------------------------------------------------------------------------
# 6. Magnitude difference exactly at limit (= 3.0) → v_only (not matched)
# ---------------------------------------------------------------------------
def test_v_only_magnitude_diff_exactly_at_limit(db_session):
    add_v(mw=3.5)
    # Δm = 3.0, condition is dm >= DM_LIMIT (3.0), so this should be excluded
    add_s("s005", dt="2023-06-15 12:00:01", lat=64.005, lon=-22.005, mag=6.5)
    run_merge()
    rows = merged_rows()
    assert rows[0].status == "v_only"


# ---------------------------------------------------------------------------
# 7. Two matching S candidates → ambiguous → v_only (policy A)
# ---------------------------------------------------------------------------
def test_ambiguous_two_s_candidates_gives_v_only(db_session):
    add_v(lat=64.0, lon=-22.0, mw=3.5)
    add_s("s006a", dt="2023-06-15 12:00:01", lat=64.005, lon=-22.005, mag=3.4)
    add_s("s006b", dt="2023-06-15 12:00:02", lat=64.003, lon=-22.003, mag=3.6)
    run_merge()
    rows = merged_rows()
    assert len(rows) == 1
    assert rows[0].status == "v_only"


# ---------------------------------------------------------------------------
# 8. Depth policy 'v' → merged depth comes from V
# ---------------------------------------------------------------------------
def test_depth_policy_v_uses_mpgv_depth(db_session):
    original = rec.DEPTH_POLICY
    rec.DEPTH_POLICY = "v"
    try:
        add_v(depth=5.0, mw=3.5)
        add_s("s007", dt="2023-06-15 12:00:01", lat=64.005, lon=-22.005, depth=20.0, mag=3.4)
        run_merge()
        rows = merged_rows()
        assert abs(rows[0].depth - 5.0) < 1e-6
    finally:
        rec.DEPTH_POLICY = original


# ---------------------------------------------------------------------------
# 9. Depth policy 's' → merged depth comes from S
# ---------------------------------------------------------------------------
def test_depth_policy_s_uses_skjalftalisa_depth(db_session):
    original = rec.DEPTH_POLICY
    rec.DEPTH_POLICY = "s"
    try:
        add_v(depth=5.0, mw=3.5)
        add_s("s008", dt="2023-06-15 12:00:01", lat=64.005, lon=-22.005, depth=20.0, mag=3.4)
        run_merge()
        rows = merged_rows()
        assert abs(rows[0].depth - 20.0) < 1e-6
    finally:
        rec.DEPTH_POLICY = original


# ---------------------------------------------------------------------------
# 10. min_mag filter: V event below 3.0 should NOT appear in merged
# ---------------------------------------------------------------------------
def test_v_below_min_mag_not_merged(db_session):
    add_v(mw=2.5)  # below 3.0 threshold
    run_merge()
    rows = merged_rows()
    assert len(rows) == 0


# ---------------------------------------------------------------------------
# 11. Idempotency: running merge twice produces the same single result
# ---------------------------------------------------------------------------
def test_idempotent_rerun(db_session):
    add_v()
    run_merge()
    run_merge()  # second run
    rows = merged_rows()
    assert len(rows) == 1  # no duplicates


# ---------------------------------------------------------------------------
# 12. match_dt_sec and match_dist_km are recorded on a matched row
# ---------------------------------------------------------------------------
def test_matched_diagnostics_recorded(db_session):
    add_v(lat=64.0, lon=-22.0, mw=3.5)
    add_s("s009", dt="2023-06-15 12:00:02", lat=64.005, lon=-22.005, mag=3.4)
    run_merge()
    r = merged_rows()[0]
    assert r.status == "matched"
    assert r.match_dt_sec == pytest.approx(2.0, abs=0.1)
    assert r.match_dist_km < 10.0
    assert r.match_dm == pytest.approx(0.1, abs=0.01)


# ---------------------------------------------------------------------------
# 13. Multiple V events each get their own merged row
# ---------------------------------------------------------------------------
def test_multiple_v_events_each_produce_merged_row(db_session):
    add_v(dt="2023-06-15 10:00:00", lat=64.0, lon=-22.0, mw=3.5)
    add_v(dt="2023-06-15 14:00:00", lat=65.0, lon=-18.0, mw=4.0)
    run_merge()
    rows = merged_rows()
    assert len(rows) == 2
