from unittest.mock import Mock, patch

from volcano_scraper import DEFAULT_HEADERS, fetch_and_merge


def _response(payload):
    response = Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = payload
    return response


def test_fetch_and_merge_uses_documented_epos_catalog_url_first():
    payload = [
        {
            "name": "Hekla",
            "lat_dd": 63.992,
            "lon_dd": -19.667,
            "height": 1491,
            "area": "South Iceland",
        }
    ]

    with patch("volcano_scraper.requests.get", return_value=_response(payload)) as mock_get:
        rows = fetch_and_merge()

    assert len(rows) == 1
    assert rows[0]["name"] == "Hekla"
    assert rows[0]["latitude"] == 63.992
    assert rows[0]["longitude"] == -19.667
    mock_get.assert_called_once_with(
        "https://api.vedur.is/epos/volcano/general-information/list-of-volcanoes",
        headers=DEFAULT_HEADERS,
        timeout=25,
    )


def test_fetch_and_merge_falls_back_to_v1_and_handles_wrapped_payload():
    wrapped_payload = {
        "data": [
            {
                "name": "Katla",
                "latitude": 63.633,
                "longitude": -19.05,
                "elevation": 1512,
                "area": "Myrdalsjokull",
            }
        ]
    }

    def fake_get(url, headers, timeout):
        if "/epos/volcano/" in url and "/epos/v1/" not in url:
            raise Exception("404")
        return _response(wrapped_payload)

    with patch("volcano_scraper.requests.get", side_effect=fake_get) as mock_get:
        rows = fetch_and_merge()

    assert len(rows) == 1
    assert rows[0]["name"] == "Katla"
    assert rows[0]["elevation_m"] == 1512.0
    assert mock_get.call_count == 4


def test_fetch_and_merge_returns_empty_when_api_returns_nothing():
    with patch("volcano_scraper.requests.get", side_effect=Exception("network down")):
        rows = fetch_and_merge()

    assert rows == []
