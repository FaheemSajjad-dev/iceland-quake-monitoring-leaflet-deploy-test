# Merges MPGV rows with IMO Quakes API rows into EarthquakeMerged.
# Match criteria: abs(dt) <= 2s, dist < DIST_LIMIT_KM, abs(dMw) < DM_LIMIT.
# Exactly one one-to-one match -> 'matched' (S location/depth, V time/Mw);
# no match, ambiguous V candidates, or losing duplicate-S candidates -> 'v_only'.
from datetime import datetime, timedelta, timezone
from math import radians, sin, cos, asin, sqrt

from app import app, db, Earthquake, EarthquakeMerged, EarthquakeSRaw

DIST_LIMIT_KM = 10.0
DM_LIMIT = 3.0

DEPTH_POLICY = 's'         # use Quakes API depth when matched
DEPTH_AVG_THR_KM = 5.0     # if using 'avg_if_close', average when |V-S| < 5 km

def haversine_km(lat1, lon1, lat2, lon2):
    """Return great-circle distance in km between two WGS-84 points."""
    R = 6371.0
    p1, p2 = radians(lat1), radians(lat2)
    dphi  = radians(lat2 - lat1)
    dlmb  = radians(lon2 - lon1)
    a = sin(dphi/2)**2 + cos(p1)*cos(p2)*sin(dlmb/2)**2
    return 2 * R * asin(sqrt(a))

def match_and_merge(start_utc, end_utc, min_mag=3.0):
    with app.app_context():
        s_rows = EarthquakeSRaw.query.filter(
            EarthquakeSRaw.date_time >= start_utc,
            EarthquakeSRaw.date_time <= end_utc
        ).all()

        s_by_sec = {}
        for s in s_rows:
            # s.date_time is 'YYYY-MM-DD HH:MM:SS' UTC
            s_by_sec.setdefault(s.date_time, []).append(s)

        v_rows = Earthquake.query.filter(
            Earthquake.date_time >= start_utc,
            Earthquake.date_time <= end_utc,
            Earthquake.mw_mean >= min_mag
        ).all()

        # Clear merged rows in this window so reruns are idempotent.
        EarthquakeMerged.query.filter(
            EarthquakeMerged.date_time >= start_utc,
            EarthquakeMerged.date_time <= end_utc
        ).delete()
        db.session.commit()

        v_candidates = {}
        for v in v_rows:
            vt = v.date_time
            base = datetime.strptime(vt, "%Y-%m-%d %H:%M:%S")
            secs = [(base + timedelta(seconds=delta)).strftime("%Y-%m-%d %H:%M:%S") for delta in (-2, -1, 0, 1, 2)]

            candidates = []
            for ts in secs:
                for s in s_by_sec.get(ts, []):
                    dist = haversine_km(v.latitude, v.longitude, s.latitude, s.longitude)
                    if dist >= DIST_LIMIT_KM:
                        continue
                    dm = abs((v.mw_mean or 0.0) - (s.magnitude or v.mw_mean or 0.0))
                    if dm >= DM_LIMIT:
                        continue
                    dt_abs = abs((datetime.strptime(vt, "%Y-%m-%d %H:%M:%S") - datetime.strptime(s.date_time, "%Y-%m-%d %H:%M:%S")).total_seconds())
                    score = (dt_abs, dist, dm, v.id or 0)
                    candidates.append((score, dist, dt_abs, dm, s))

            v_candidates[v.id] = candidates

        selected_by_s = {}
        for v in v_rows:
            for score, dist, dt_abs, dm, s in v_candidates.get(v.id, []):
                current = selected_by_s.get(s.event_id)
                if current is None or score < current[0]:
                    selected_by_s[s.event_id] = (score, v.id, dist, dt_abs, dm, s)

        assigned = {}
        for s_event_id, (score, v_id, dist, dt_abs, dm, s) in selected_by_s.items():
            if len(v_candidates.get(v_id, [])) == 1:
                assigned[v_id] = (dist, dt_abs, dm, s)

        inserted = 0
        n_matched = 0
        n_v_only = 0
        for v in v_rows:
            match = assigned.get(v.id)

            if match is None:
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

            else:
                dist, dt_abs, dm, s_best = match
                # DEPTH_POLICY options: 'v' = MPGV, 's' = Quakes API,
                # 'avg_if_close' = average when source depths are close.
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
                    depth_value = v.depth

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

        db.session.commit()
        print(f"Total: {inserted}")
        print(f"  Matched: {n_matched}")
        print(f"  V-only:  {n_v_only}")

if __name__ == "__main__":
    end = datetime.now(timezone.utc).replace(microsecond=0)
    start = end - timedelta(days=30)
    start_str = start.strftime("%Y-%m-%d %H:%M:%S")
    end_str   = end.strftime("%Y-%m-%d %H:%M:%S")
    match_and_merge(start_str, end_str, min_mag=3.0)
