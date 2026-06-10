"""
Validate and cache EPOS ShakeMap associations for merged earthquake events.

For each event in EarthquakeMerged, queries the EPOS ShakeMap API within a
±30 min / ±0.3° window, picks the best candidate by (distance, time, magnitude),
and writes the result to the shakemap_links cache table.
"""
from __future__ import annotations
import os, sys, math, json, time
from datetime import datetime, timedelta
from typing import Optional, Tuple, Dict, Any, List

import requests
import pandas as pd

BASE_DIR = os.path.dirname(__file__)
sys.path.insert(0, BASE_DIR)
from app import app, db, EarthquakeMerged, ShakeMapLink

EPOS_SHAKEMAP_API = "https://api.epos-iceland.is/v1/seismic/shakemaps"

DT_LIMIT_SEC = 10 * 60     # 10 minutes
DIST_LIMIT_KM = 10.0       # 10 km (set 5.0 to be stricter)
DM_LIMIT = 0.5             # magnitude tolerance for ShakeMap (often ML)
BBOX_PAD_DEG = 0.3         # bbox padding around event for API query
OUT_DIR = os.path.join(BASE_DIR, "reports")
os.makedirs(OUT_DIR, exist_ok=True)

def hav_km(a_lat, a_lon, b_lat, b_lon) -> float:
    R=6371.0
    from math import radians, sin, cos, asin
    p1, p2 = radians(a_lat), radians(b_lat)
    dlat = radians(b_lat - a_lat)
    dlon = radians(b_lon - a_lon)
    x = sin(dlat/2)**2 + cos(p1)*cos(p2)*sin(dlon/2)**2
    return 2*R*asin(min(1.0, x**0.5))

def parse_dt(s: str) -> datetime:
    s = s.replace("T", " ").replace("Z", "")
    if "." in s:
        return datetime.strptime(s, "%Y-%m-%d %H:%M:%S.%f")
    return datetime.strptime(s, "%Y-%m-%d %H:%M:%S")

def within_limits(dt_sec: float, dist_km: float, dm: Optional[float]) -> bool:
    if abs(dt_sec) > DT_LIMIT_SEC: return False
    if dist_km > DIST_LIMIT_KM: return False
    if dm is not None and abs(dm) > DM_LIMIT: return False
    return True

def fetch_shakemaps_window(dt: datetime, lat: float, lon: float) -> List[Dict[str, Any]]:
    start = (dt - timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M:%S")
    end   = (dt + timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M:%S")
    bbox = f"{lat-BBOX_PAD_DEG},{lon-BBOX_PAD_DEG},{lat+BBOX_PAD_DEG},{lon+BBOX_PAD_DEG}"
    params = {"start_time": start, "end_time": end, "bbox": bbox}
    r = requests.get(EPOS_SHAKEMAP_API, params=params, timeout=20)
    r.raise_for_status()
    return r.json()

def pick_best_shakemap(cands: List[Dict[str, Any]], e_dt: datetime, e_lat: float, e_lon: float, e_Mw: float):
    """Return (choice, dt_sec, dist_km, dm) or (None, ...)."""
    best = None
    for c in cands:
        # keys: 'origin_time','latitude','longitude','auto_depth','ml_auto','mM','url_view_file'...
        sm_dt = parse_dt(c.get("origin_time"))
        sm_lat = float(c.get("latitude"))
        sm_lon = float(c.get("longitude"))
        sm_M = c.get("ml_auto") or c.get("mM")  # whichever exists
        sm_M = float(sm_M) if sm_M is not None and sm_M != "" else None

        dt_sec = abs((e_dt - sm_dt).total_seconds())
        dist_km = hav_km(e_lat, e_lon, sm_lat, sm_lon)
        dm = (e_Mw - sm_M) if sm_M is not None else None

        # keep only those inside hard limits
        if within_limits(dt_sec, dist_km, dm):
            score = (dist_km, dt_sec, abs(dm) if dm is not None else 0.0)
            item = (c, dt_sec, dist_km, dm, score)
            if best is None or score < best[-1]:
                best = item
    return best  # might be None



def ensure_table():
    with app.app_context():
        db.create_all()

def audit_all():
    ensure_table()
    rows_out = []
    with app.app_context():
        db.session.expire_on_commit = False

        # SNAPSHOT plain values up-front (no ORM instances in the loop)
        rows = (
            db.session.query(
                EarthquakeMerged.date_time,
                EarthquakeMerged.latitude,
                EarthquakeMerged.longitude,
                EarthquakeMerged.mw_mean
            )
            .all()
        )
        # rows is a list of 4-tuples
        for ev_dt_str, ev_lat, ev_lon, ev_Mw in rows:
            ev_dt_str = str(ev_dt_str)
            ev_lat = float(ev_lat)
            ev_lon = float(ev_lon)
            ev_Mw  = float(ev_Mw or 0.0)

            try:
                e_dt = parse_dt(ev_dt_str)

                # fetch window around event
                cands = fetch_shakemaps_window(e_dt, ev_lat, ev_lon)
                choice = pick_best_shakemap(cands, e_dt, ev_lat, ev_lon, ev_Mw)

                if choice is None:
                    status = "no_valid" if cands else "no_candidate"
                    rec = dict(
                        dt=ev_dt_str, lat=ev_lat, lon=ev_lon, Mw=ev_Mw,
                        status=status, url_view_file=None, dt_sec=None, dist_km=None, dm=None
                    )
                else:
                    c, dt_sec, dist_km, dm, _ = choice
                    rec = dict(
                        dt=ev_dt_str, lat=ev_lat, lon=ev_lon, Mw=ev_Mw,
                        status="valid",
                        url_view_file=c.get("url_view_file"),
                        dt_sec=round(dt_sec, 2),
                        dist_km=round(dist_km, 3),
                        dm=round(dm, 2) if dm is not None else None,
                        sm_lat=float(c.get("latitude")),
                        sm_lon=float(c.get("longitude")),
                        sm_mag=float(c.get("ml_auto") or c.get("mM") or 0.0),
                        sm_depth=float(c.get("auto_depth") or 0.0),
                        origin_time=c.get("origin_time"),
                    )

                # upsert cache using Session.get (SQLAlchemy 2.x style)
                link = db.session.get(ShakeMapLink, ev_dt_str) or ShakeMapLink(dt=ev_dt_str)
                for k, v in rec.items():
                    if hasattr(link, k):
                        setattr(link, k, v)
                db.session.add(link)
                db.session.commit()

                rows_out.append(rec)

            except Exception as ex:
                db.session.rollback()
                rows_out.append(dict(
                    dt=ev_dt_str, lat=ev_lat, lon=ev_lon, Mw=ev_Mw,
                    status="error", url_view_file=None, dt_sec=None, dist_km=None, dm=None, note=str(ex)
                ))
                time.sleep(0.2)

    df = pd.DataFrame(rows_out)
    csv_path = os.path.join(OUT_DIR, "shakemap_audit.csv")
    df.to_csv(csv_path, index=False)
    kpi = df["status"].value_counts().to_dict()
    print("Audit counts:", kpi)
    print("CSV:", csv_path)

if __name__ == "__main__":
    audit_all()