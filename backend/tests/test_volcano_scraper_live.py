import os

import pytest
import requests


pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_LIVE_EPOS_TESTS") != "1",
    reason="set RUN_LIVE_EPOS_TESTS=1 to exercise the live EPOS API",
)


def test_live_epos_volcano_catalog_returns_rows():
    response = requests.get(
        "https://api.vedur.is/epos/volcano/general-information/list-of-volcanoes",
        headers={"Accept": "application/json"},
        timeout=20,
    )
    response.raise_for_status()

    payload = response.json()
    assert isinstance(payload, list)
    assert payload

    first = payload[0]
    assert "name" in first
    assert ("lat_dd" in first or "latitude" in first)
    assert ("lon_dd" in first or "longitude" in first)
