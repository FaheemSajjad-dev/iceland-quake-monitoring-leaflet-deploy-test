import pytest


def test_earthquakes_rate_limit_can_be_configured(test_app, monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_EARTHQUAKES", "1 per minute")

    client = test_app.test_client()

    first = client.get("/earthquakes")
    second = client.get("/earthquakes")

    assert first.status_code == 200
    assert second.status_code == 429


def test_health_endpoint_is_not_rate_limited(test_app, monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_DEFAULT", "1 per minute")

    client = test_app.test_client()

    assert client.get("/health").status_code == 200
    assert client.get("/health").status_code == 200


@pytest.mark.parametrize(
    ("path", "env_name"),
    [
        ("/volcanoes", "RATE_LIMIT_VOLCANOES"),
        ("/earthquakes_csv", "RATE_LIMIT_CSV"),
        ("/shakemap/2026-01-01%2000:00:00", "RATE_LIMIT_SHAKEMAP"),
    ],
)
def test_public_endpoint_specific_limits(test_app, monkeypatch, path, env_name):
    monkeypatch.setenv(env_name, "1 per minute")

    client = test_app.test_client()

    first = client.get(path)
    second = client.get(path)

    assert first.status_code in {200, 404}
    assert second.status_code == 429
