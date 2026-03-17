"""
Merge MPGV (Earthquake) and Skjálftalísa (EarthquakeSRaw) events into EarthquakeMerged.

Matching rules (all three must pass):
  |Δt|    ≤ 2 s           (±2 second time bucket search)
  dist     < DIST_LIMIT_KM (haversine surface distance)
  |ΔMw|   < DM_LIMIT       (magnitude sanity check)

When exactly one candidate matches: 'matched' — S lat/lon/depth used, V time/Mw.
When zero or ≥2 candidates match: 'v_only' — all fields from MPGV.
"""
from datetime import datetime, timedelta, timezone
from math import radians, sin, cos, asin, sqrt

from app import app, db, Earthquake, EarthquakeMerged, EarthquakeSRaw

DIST_LIMIT_KM = 10.0
DM_LIMIT = 3.0

DEPTH_POLICY = 's'         # use Skjálftalísa depth when matched
DEPTH_AVG_THR_KM = 5.0     # if using 'avg_if_close', average when |V-S| < 5 km

def haversine_km(lat1, lon1, lat2, lon2):
    """Return great-circle distance in km between two WGS-84 points."""
    R = 6371.0
    p1, p2 = radians(lat1), radians(lat2)
    dphi  = radians(lat2 - lat1)
    dlmb  = radians(lon2 - lon1)
    a = sin(dphi/2)**2 + cos(p1)*cos(p2)*sin(dlmb/2)**2
    return 2 * R * asin(sqrt(a))

def match_and_merge(start_utc, end_utc, min_mag=2.7):
    """
    Match MPGV events (Earthquake) against Skjálftalísa (earthquake_s_raw)
    and write results to earthquake_merged.
    """
    with app.app_context():
        # 1) Load S rows into time-buckets (second -> list)
        s_rows = EarthquakeSRaw.query.filter(
            EarthquakeSRaw.date_time >= start_utc,
            EarthquakeSRaw.date_time <= end_utc
        ).all()

        s_by_sec = {}
        for s in s_rows:
            # s.date_time is 'YYYY-MM-DD HH:MM:SS' UTC
            s_by_sec.setdefault(s.date_time, []).append(s)

        # 2) Load V rows (MPGV)
        v_rows = Earthquake.query.filter(
            Earthquake.date_time >= start_utc,
            Earthquake.date_time <= end_utc,
            Earthquake.mw_mean >= min_mag
        ).all()

        # 3) Clear merged rows in this window (idempotent reruns)
        EarthquakeMerged.query.filter(
            EarthquakeMerged.date_time >= start_utc,
            EarthquakeMerged.date_time <= end_utc
        ).delete()
        db.session.commit()

        # 4) Match each v to s
        inserted = 0
        n_matched = 0
        n_v_only = 0
        for v in v_rows:
            # try ±2 seconds around v.date_time (enforces |Δt| ≤ 2s)
            vt = v.date_time  # 'YYYY-MM-DD HH:MM:SS'
            # build nearby seconds strings
            base = datetime.strptime(vt, "%Y-%m-%d %H:%M:%S")
            secs = [(base + timedelta(seconds=delta)).strftime("%Y-%m-%d %H:%M:%S") for delta in (-2, -1, 0, 1, 2)]

            candidates = []
            for ts in secs:
                for s in s_by_sec.get(ts, []):
                    # |Δt| check satisfied by the ±2s list
                    dist = haversine_km(v.latitude, v.longitude, s.latitude, s.longitude)
                    if dist >= DIST_LIMIT_KM:
                        continue
                    dm = abs((v.mw_mean or 0.0) - (s.magnitude or v.mw_mean or 0.0))
                    if dm >= DM_LIMIT:
                        continue
                    # keep (distance, abs dt, dm, s)
                    dt_abs = abs((datetime.strptime(vt, "%Y-%m-%d %H:%M:%S") - datetime.strptime(s.date_time, "%Y-%m-%d %H:%M:%S")).total_seconds())
                    candidates.append((dist, dt_abs, dm, s))

            if len(candidates) == 0:
                # v_only
                m = EarthquakeMerged(
                    date_time=v.date_time,
                    latitude=v.latitude,
                    longitude=v.longitude,
                    depth=v.depth,
                    mw_mean=v.mw_mean,
                    status="v_only",
                    s_event_id=None,
                    match_dt_sec=None,
                    match_dist_km=None,
                    match_dm=None
                )
                db.session.add(m)
                inserted += 1
                n_v_only += 1

            elif len(candidates) == 1:
                # exactly one → accept (use S location and depth)
                dist, dt_abs, dm, s_best = candidates[0]
                # ----- DEPTH POLICY -----
                # 'v' = MPGV depth
                # 's' = Skjalftalísa depth
                # 'avg_if_close' = average if difference < threshold
                if DEPTH_POLICY == 's':
                    depth_value = s_best.depth
                elif DEPTH_POLICY == 'avg_if_close':
                    try:
                        if abs((v.depth or 0) - (s_best.depth or 0)) < DEPTH_AVG_THR_KM:
                            depth_value = (float(v.depth) + float(s_best.depth)) / 2.0
                        else:
                            depth_value = v.depth
                    except Exception:
                        depth_value = v.depth
                else:
                    # default → MPGV depth
                    depth_value = v.depth
                # ----- END DEPTH POLICY -----

                m = EarthquakeMerged(
                    date_time=v.date_time,
                    latitude=s_best.latitude,
                    longitude=s_best.longitude,
                    depth=depth_value,
                    mw_mean=v.mw_mean,
                    status="matched",
                    v_src_key=f"{v.date_time}_{v.latitude}_{v.longitude}",
                    s_event_id=s_best.event_id,
                    match_dt_sec=dt_abs,
                    match_dist_km=dist,
                    match_dm=dm
                )
                db.session.add(m)
                inserted += 1
                n_matched += 1

            else:
                # ≥2 candidates — ambiguous, fall back to v_only
                m = EarthquakeMerged(
                    date_time=v.date_time,
                    latitude=v.latitude,
                    longitude=v.longitude,
                    depth=v.depth,
                    mw_mean=v.mw_mean,
                    status="v_only",
                    s_event_id=None,
                    match_dt_sec=None,
                    match_dist_km=None,
                    match_dm=None
                )
                db.session.add(m)
                inserted += 1
                n_v_only += 1

        db.session.commit()
        print(f"Total: {inserted}")
        print(f"  Matched: {n_matched}")
        print(f"  V-only:  {n_v_only}")

if __name__ == "__main__":
    end = datetime.now(timezone.utc).replace(microsecond=0)
    start = end - timedelta(days=30)
    start_str = start.strftime("%Y-%m-%d %H:%M:%S")
    end_str   = end.strftime("%Y-%m-%d %H:%M:%S")
    match_and_merge(start_str, end_str, min_mag=2.7)