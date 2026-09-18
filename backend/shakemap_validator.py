"""Optional offline audit using the same exact MPGV-time policy as live lookup."""
from __future__ import annotations

import math
import os
import sys

import pandas as pd
import requests

BASE_DIR = os.path.dirname(__file__)
sys.path.insert(0, BASE_DIR)
from app import app, db, EarthquakeMerged, ShakeMapLink, _validate_shakemap_url, REQUEST_TIMEOUT
from shakemap_matching import EPOS_SHAKEMAP_API, POLICY_NOTE, select_shakemap

OUT_DIR = os.path.join(BASE_DIR, "reports")


def optional_number(value):
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def audit_all():
    # Fetch once before changing cached associations. Upstream failure must not
    # turn the entire cache into apparent 'no match' results.
    response = requests.get(EPOS_SHAKEMAP_API, timeout=REQUEST_TIMEOUT, allow_redirects=False)
    response.raise_for_status()
    if "json" not in response.headers.get("Content-Type", "").lower():
        raise ValueError("Expected an EPOS JSON response")
    products = response.json()
    if not isinstance(products, list):
        raise ValueError("Expected an EPOS product list")

    rows_out = []
    with app.app_context():
        db.create_all()
        # Snapshot scalars so the commit cannot expire rows during iteration.
        rows = db.session.query(EarthquakeMerged.date_time, EarthquakeMerged.mw_mean).all()
        for event_time, magnitude in rows:
            product, reason = select_shakemap(products, event_time, _validate_shakemap_url)
            record = dict(
                dt=event_time, status="valid" if product else reason,
                note=POLICY_NOTE, url_view_file=None, origin_time=None,
                sm_lat=None, sm_lon=None, sm_mag=None, sm_depth=None,
                dt_sec=None, dist_km=None, dm=None,
            )
            if product:
                product_mw = optional_number(product.get("mw"))
                event_mw = optional_number(magnitude)
                record.update(
                    url_view_file=product["url_view_file"],
                    origin_time=product["origin_time"], dt_sec=0.0,
                    sm_lat=optional_number(product.get("latitude")),
                    sm_lon=optional_number(product.get("longitude")),
                    sm_depth=optional_number(product.get("auto_depth")),
                    sm_mag=product_mw,
                    dm=event_mw-product_mw if event_mw is not None and product_mw is not None else None,
                )
            link = db.session.get(ShakeMapLink, event_time) or ShakeMapLink(dt=event_time)
            for key, value in record.items():
                setattr(link, key, value)
            db.session.add(link)
            rows_out.append(record)
        # Replace all audited results together, or none.
        db.session.commit()

    os.makedirs(OUT_DIR, exist_ok=True)
    frame = pd.DataFrame(rows_out, columns=[
        "dt", "status", "note", "url_view_file", "origin_time", "sm_lat", "sm_lon",
        "sm_mag", "sm_depth", "dt_sec", "dist_km", "dm",
    ])
    csv_path = os.path.join(OUT_DIR, "shakemap_audit.csv")
    frame.to_csv(csv_path, index=False)
    print("Audit counts:", frame["status"].value_counts().to_dict())
    print("CSV:", csv_path)


if __name__ == "__main__":
    audit_all()
