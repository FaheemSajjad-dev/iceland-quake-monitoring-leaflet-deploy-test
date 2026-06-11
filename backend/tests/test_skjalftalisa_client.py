from datetime import datetime, timezone
from unittest.mock import Mock, patch

import skjalftalisa_client as client


def _response(payload):
    response = Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = payload
    return response


def test_fetch_uses_quakes_api_events_endpoint_and_query_params():
    payload = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [-21.443462, 64.063896],
                },
                "properties": {
                    "event_id": "IMO2026ksfzzn",
                    "time": "2026-06-01T13:45:11.431726Z",
                    "magnitude": 4.505671,
                    "depth": 4.496746,
                    "type": "earthquake",
                },
            }
        ],
    }

    start = datetime(2026, 6, 1, 0, 0, tzinfo=timezone.utc)
    end = datetime(2026, 6, 2, 0, 0, tzinfo=timezone.utc)

    with patch("skjalftalisa_client.requests.get", return_value=_response(payload)) as mock_get:
        rows = client.fetch_skjalftalisa(start, end, size_min=3.0)

    mock_get.assert_called_once_with(
        "https://api.vedur.is/quakes/events",
        params={
            "start_time": "2026-06-01T00:00:00Z",
            "end_time": "2026-06-02T00:00:00Z",
            "size_min": 3.0,
            "format": "json",
        },
        timeout=20,
    )
    assert rows == [
        {
            "event_id": "IMO2026ksfzzn",
            "time": "2026-06-01 13:45:11",
            "lat": 64.063896,
            "long": -21.443462,
            "depth": 4.496746,
            "magnitude": 4.505671,
        }
    ]


def test_fetch_skips_malformed_features():
    payload = {
        "type": "FeatureCollection",
        "features": [
            {"geometry": {"coordinates": []}, "properties": {"time": "2026-06-01T00:00:00Z"}},
            {"geometry": {"coordinates": [-21.0, 64.0]}, "properties": {"time": "bad"}},
            {"geometry": {"coordinates": [-20.0, 65.0]}, "properties": {"event_id": "ok", "time": "2026-06-01T00:00:00Z"}},
        ],
    }

    with patch("skjalftalisa_client.requests.get", return_value=_response(payload)):
        rows = client.fetch_skjalftalisa(
            datetime(2026, 6, 1, tzinfo=timezone.utc),
            datetime(2026, 6, 2, tzinfo=timezone.utc),
        )

    assert len(rows) == 1
    assert rows[0]["event_id"] == "ok"
    assert rows[0]["lat"] == 65.0
    assert rows[0]["long"] == -20.0


def test_fetch_before_cutoff_returns_empty_without_request():
    with patch("skjalftalisa_client.requests.get") as mock_get:
        rows = client.fetch_skjalftalisa(
            datetime(2020, 5, 1, tzinfo=timezone.utc),
            datetime(2020, 5, 2, tzinfo=timezone.utc),
        )

    assert rows == []
    mock_get.assert_not_called()