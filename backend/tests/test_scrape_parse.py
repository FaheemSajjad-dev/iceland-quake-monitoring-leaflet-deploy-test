"""
Unit tests for get_monthly_data() in scrape.py.

get_monthly_data(year, month) fetches an HTML table from hraun.vedur.is and
returns a list of earthquake dicts filtered to magnitude >= 3.0.

All network calls are mocked so no real HTTP requests are made.
"""
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock

import pytest
import requests

from app import Earthquake
from scrape import (
    CatalogueValidationError,
    _scrape_and_save_with_flask,
    fetch_authoritative_catalogue,
    get_monthly_data,
    sync_authoritative_rows,
    validate_candidate_catalogue,
)


def _make_response(html: str) -> MagicMock:
    """Helper: fake requests.Response whose .content returns bytes."""
    mock = MagicMock()
    mock.content = html.encode("utf-8")
    return mock


def _html_table(*rows: tuple) -> str:
    """
    Build a minimal HTML page containing the MPGV-style dataframe table.
    Each row is a tuple of 8 strings:
        (date_time, lat, lon, depth, col4, col5, mw_mean, col7)
    """
    tr_blocks = []
    for r in rows:
        tds = "".join(f"<td>{v}</td>" for v in r)
        tr_blocks.append(f"<tr>{tds}</tr>")
    tbody = "\n".join(tr_blocks)
    return f"""
    <html><body>
    <table class="dataframe">
      <thead><tr><th>Time</th><th>Lat</th><th>Lon</th><th>Depth</th>
             <th>X</th><th>X</th><th>Mw</th><th>X</th></tr></thead>
      <tbody>{tbody}</tbody>
    </table>
    </body></html>
    """


def _candidate(source_id, *, lat=64.0, lon=-22.0, depth=5.0, mw=3.2):
    return {
        "date_time": source_id,
        "source_id": source_id,
        "latitude": lat,
        "longitude": lon,
        "depth": depth,
        "mw_mean": mw,
    }


def _catalogue_router(month_html, *, month_error=None):
    def get(url, timeout):
        if url.endswith("/Mpgv/"):
            return _make_response('<a href="2026/">2026</a>')
        if url.endswith("/Mpgv/2026/"):
            return _make_response('<a href="2026-07.html">July</a>')
        if url.endswith("/Mpgv/2026/2026-07.html"):
            response = _make_response(month_html)
            if month_error is not None:
                response.raise_for_status.side_effect = month_error
            return response
        raise AssertionError(f"Unexpected URL: {url}")
    return get


# ---------------------------------------------------------------------------
# Basic parsing
# ---------------------------------------------------------------------------

class TestGetMonthlyDataParsing:

    def test_returns_list_of_dicts(self):
        html = _html_table(("2023-06-15 12:00:00", "64.1", "-22.0", "5.0", "", "", "3.0", ""))
        with patch("scrape.requests.get", return_value=_make_response(html)):
            result = get_monthly_data(2023, 6)
        assert isinstance(result, list)
        assert len(result) == 1
        assert isinstance(result[0], dict)

    def test_correct_field_values(self):
        html = _html_table(("2023-06-15 12:00:00", "64.15", "-22.05", "7.5", "", "", "3.2", ""))
        with patch("scrape.requests.get", return_value=_make_response(html)):
            result = get_monthly_data(2023, 6)
        eq = result[0]
        assert eq["date_time"] == "2023-06-15 12:00:00"
        assert eq["latitude"] == 64.15
        assert eq["longitude"] == -22.05
        assert eq["depth"] == 7.5
        assert eq["mw_mean"] == 3.2

    def test_multiple_rows_returned(self):
        html = _html_table(
            ("2023-06-01 08:00:00", "64.0", "-22.0", "5.0", "", "", "3.0", ""),
            ("2023-06-02 09:30:00", "65.0", "-18.0", "10.0", "", "", "4.1", ""),
        )
        with patch("scrape.requests.get", return_value=_make_response(html)):
            result = get_monthly_data(2023, 6)
        assert len(result) == 2


# ---------------------------------------------------------------------------
# Magnitude filter (must be >= 3.0)
# ---------------------------------------------------------------------------

class TestMagnitudeFilter:

    def test_below_threshold_excluded(self):
        html = _html_table(("2023-06-15 12:00:00", "64.1", "-22.0", "5.0", "", "", "2.5", ""))
        with patch("scrape.requests.get", return_value=_make_response(html)):
            result = get_monthly_data(2023, 6)
        assert result == []

    def test_exactly_at_threshold_included(self):
        html = _html_table(("2023-06-15 12:00:00", "64.1", "-22.0", "5.0", "", "", "3.0", ""))
        with patch("scrape.requests.get", return_value=_make_response(html)):
            result = get_monthly_data(2023, 6)
        assert len(result) == 1

    def test_above_threshold_included(self):
        html = _html_table(("2023-06-15 12:00:00", "64.1", "-22.0", "5.0", "", "", "5.0", ""))
        with patch("scrape.requests.get", return_value=_make_response(html)):
            result = get_monthly_data(2023, 6)
        assert len(result) == 1

    def test_mixed_magnitudes_filtered_correctly(self):
        html = _html_table(
            ("2023-06-01 08:00:00", "64.0", "-22.0", "5.0", "", "", "2.5", ""),  # excluded
            ("2023-06-02 09:30:00", "64.0", "-22.0", "5.0", "", "", "3.0", ""),  # included
            ("2023-06-03 10:00:00", "64.0", "-22.0", "5.0", "", "", "3.5", ""),  # included
        )
        with patch("scrape.requests.get", return_value=_make_response(html)):
            result = get_monthly_data(2023, 6)
        assert len(result) == 2
        assert all(r["mw_mean"] >= 3.0 for r in result)


# ---------------------------------------------------------------------------
# Datetime format handling
# ---------------------------------------------------------------------------

class TestDatetimeParsing:

    def test_datetime_with_microseconds(self):
        # Format: '%Y-%m-%d %H:%M:%S.%f'
        html = _html_table(("2023-06-15 12:00:00.123456", "64.1", "-22.0", "5.0", "", "", "3.0", ""))
        with patch("scrape.requests.get", return_value=_make_response(html)):
            result = get_monthly_data(2023, 6)
        assert result[0]["date_time"] == "2023-06-15 12:00:00.123456"
        assert result[0]["source_id"] == "2023-06-15 12:00:00.123456"

    def test_datetime_without_microseconds(self):
        # Format: '%Y-%m-%d %H:%M:%S'
        html = _html_table(("2023-06-15 12:00:00", "64.1", "-22.0", "5.0", "", "", "3.0", ""))
        with patch("scrape.requests.get", return_value=_make_response(html)):
            result = get_monthly_data(2023, 6)
        assert result[0]["date_time"] == "2023-06-15 12:00:00"

    def test_mpgv_millisecond_identity_is_preserved(self):
        html = _html_table(
            (
                "2026-07-27 00:36:17.400",
                "64.119",
                "-21.288",
                "3.0",
                "",
                "",
                "3.95",
                "",
            )
        )
        with patch("scrape.requests.get", return_value=_make_response(html)):
            result = get_monthly_data(2026, 7)
        assert result[0]["source_id"] == "2026-07-27 00:36:17.400"


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------

class TestEdgeCases:

    def test_no_table_returns_empty_list(self):
        html = "<html><body><p>No data</p></body></html>"
        with patch("scrape.requests.get", return_value=_make_response(html)):
            result = get_monthly_data(2023, 6)
        assert result == []

    def test_empty_table_returns_empty_list(self):
        html = """
        <html><body>
        <table class="dataframe"><thead></thead><tbody></tbody></table>
        </body></html>
        """
        with patch("scrape.requests.get", return_value=_make_response(html)):
            result = get_monthly_data(2023, 6)
        assert result == []

    def test_row_with_missing_mw_skipped(self):
        html = _html_table(("2023-06-15 12:00:00", "64.1", "-22.0", "5.0", "", "", "", ""))
        with patch("scrape.requests.get", return_value=_make_response(html)):
            result = get_monthly_data(2023, 6)
        assert result == []

    def test_row_with_non_numeric_mw_skipped(self):
        html = _html_table(("2023-06-15 12:00:00", "64.1", "-22.0", "5.0", "", "", "N/A", ""))
        with patch("scrape.requests.get", return_value=_make_response(html)):
            result = get_monthly_data(2023, 6)
        assert result == []

    def test_url_format(self):
        """Verify the URL constructed for a given year/month."""
        html = _html_table(("2022-03-01 00:00:00", "64.0", "-22.0", "5.0", "", "", "3.0", ""))
        with patch("scrape.requests.get", return_value=_make_response(html)) as mock_get:
            get_monthly_data(2022, 3)
        called_url = mock_get.call_args[0][0]
        assert "2022" in called_url
        assert "03" in called_url  # zero-padded month


def test_complete_candidate_catalogue_is_fetched_and_validated():
    html = _html_table(
        ("2026-07-28 16:57:15.100", "64.136", "-18.600", "1.1", "", "", "3.00", ""),
        ("2026-07-28 16:57:19.100", "63.994", "-19.123", "1.7", "", "", "3.01", ""),
    )
    with patch(
        "scrape.requests.get",
        side_effect=_catalogue_router(html),
    ):
        rows = fetch_authoritative_catalogue(
            now=datetime(2026, 7, 29, tzinfo=timezone.utc),
            min_catalogue_rows=1,
        )

    assert [row["source_id"] for row in rows] == [
        "2026-07-28 16:57:15.100",
        "2026-07-28 16:57:19.100",
    ]


def test_month_request_failure_rejects_before_current_state_changes(
    db_session,
    monkeypatch,
):
    initial = [_candidate("2026-07-28 16:57:15.100")]
    sync_authoritative_rows(initial)
    html = _html_table(
        ("2026-07-28 16:57:15.100", "64", "-22", "5", "", "", "3.2", "")
    )
    monkeypatch.setattr(
        "scrape.requests.get",
        _catalogue_router(html, month_error=requests.HTTPError("failed page")),
    )

    with pytest.raises(requests.HTTPError):
        _scrape_and_save_with_flask()

    current = Earthquake.query.filter_by(is_current=True).all()
    assert [row.source_id for row in current] == ["2026-07-28 16:57:15.100"]


def test_expected_page_without_table_is_rejected_without_state_change(
    db_session,
    monkeypatch,
):
    initial = [_candidate("2026-07-28 16:57:15.100")]
    sync_authoritative_rows(initial)
    monkeypatch.setattr(
        "scrape.requests.get",
        _catalogue_router("<html><body>No table</body></html>"),
    )

    with pytest.raises(CatalogueValidationError, match="table missing"):
        _scrape_and_save_with_flask()

    assert Earthquake.query.filter_by(is_current=True).count() == 1


def test_truncated_syntactically_valid_catalogue_cannot_mass_inactivate(
    db_session,
):
    complete = [
        _candidate(f"2026-07-28 16:57:{second:02d}.100")
        for second in range(20)
    ]
    sync_authoritative_rows(complete)
    before = {
        row.source_id: row.is_current
        for row in Earthquake.query.order_by(Earthquake.id)
    }

    with pytest.raises(CatalogueValidationError, match="suspicious catalogue reduction"):
        sync_authoritative_rows(complete[:18])

    after = {
        row.source_id: row.is_current
        for row in Earthquake.query.order_by(Earthquake.id)
    }
    assert after == before
    assert sum(after.values()) == 20


def test_abnormally_low_candidate_requires_explicit_maintenance_override():
    rows = [_candidate("2026-07-28 16:57:15.100")]

    with pytest.raises(CatalogueValidationError, match="explicit maintenance override"):
        validate_candidate_catalogue(
            rows,
            prior_current_count=100,
            min_catalogue_rows=1,
        )

    assert validate_candidate_catalogue(
        rows,
        prior_current_count=100,
        min_catalogue_rows=1,
        allow_substantial_reduction=True,
    )["candidate_count"] == 1


def test_malformed_row_loss_is_measured_and_abnormal_loss_rejected():
    valid_rows = [
        (
            f"2026-07-28 16:{minute:02d}:15.100",
            "64.136", "-18.600", "1.1", "", "", "3.00", "",
        )
        for minute in range(59)
    ]
    malformed = ("bad-time", "bad-lat", "-18.600", "1.1", "", "", "3.00", "")
    accepted_html = _html_table(*valid_rows, malformed)
    with patch("scrape.requests.get", return_value=_make_response(accepted_html)):
        rows, diagnostics = get_monthly_data(
            2026,
            7,
            require_table=True,
            return_diagnostics=True,
        )
    assert len(rows) == 59
    assert diagnostics["malformed_rows"] == 1

    rejected_html = _html_table(valid_rows[0], malformed)
    with patch("scrape.requests.get", return_value=_make_response(rejected_html)):
        with pytest.raises(CatalogueValidationError, match="parse loss"):
            get_monthly_data(2026, 7, require_table=True)


@pytest.mark.parametrize("fraction", ["100", "400", "500"])
def test_fractional_timestamp_variants_are_preserved(fraction):
    source_id = f"2026-07-28 16:57:15.{fraction}"
    html = _html_table(
        (source_id, "64.136", "-18.600", "1.1", "", "", "3.00", "")
    )
    with patch("scrape.requests.get", return_value=_make_response(html)):
        rows = get_monthly_data(2026, 7)
    assert rows[0]["source_id"] == source_id


def test_two_events_in_same_second_remain_separate_and_idempotent(db_session):
    rows = [
        _candidate("2026-07-28 16:57:15.100"),
        _candidate("2026-07-28 16:57:15.400"),
    ]

    sync_authoritative_rows(rows)
    sync_authoritative_rows(rows)

    current = Earthquake.query.filter_by(is_current=True).order_by(
        Earthquake.source_id
    ).all()
    assert [row.source_id for row in current] == [
        "2026-07-28 16:57:15.100",
        "2026-07-28 16:57:15.400",
    ]


def test_sync_marks_revised_snapshot_current_without_deleting_raw_rows(db_session):
    stale = Earthquake(
        date_time="2026-07-27 00:36:17",
        latitude=64.119,
        longitude=-21.285,
        depth=3.3,
        mw_mean=3.94,
    )
    current = Earthquake(
        date_time="2026-07-27 00:36:17",
        latitude=64.119,
        longitude=-21.288,
        depth=3.0,
        mw_mean=3.95,
    )
    db_session.session.add_all([stale, current])
    db_session.session.commit()
    current_id = current.id

    authoritative = [{
        "date_time": "2026-07-27 00:36:17.400",
        "source_id": "2026-07-27 00:36:17.400",
        "latitude": 64.119,
        "longitude": -21.288,
        "depth": 3.0,
        "mw_mean": 3.95,
    }]
    first = sync_authoritative_rows(authoritative)
    second = sync_authoritative_rows(authoritative)

    rows = Earthquake.query.order_by(Earthquake.id).all()
    assert len(rows) == 2
    assert first["authoritative"] == second["authoritative"] == 1
    assert [row.id for row in rows if row.is_current] == [current_id]
    assert rows[0].is_current is False
    assert rows[1].source_id == "2026-07-27 00:36:17.400"


def test_same_exact_source_identity_revision_preserves_one_current_snapshot(
    db_session,
):
    source_id = "2026-07-27 00:36:17.400"
    original = _candidate(
        source_id,
        lat=64.119,
        lon=-21.285,
        depth=3.3,
        mw=3.94,
    )
    revised = _candidate(
        source_id,
        lat=64.119,
        lon=-21.288,
        depth=3.0,
        mw=3.95,
    )

    sync_authoritative_rows([original])
    sync_authoritative_rows([revised])

    rows = Earthquake.query.order_by(Earthquake.id).all()
    current = [row for row in rows if row.is_current]
    assert len(rows) == 2
    assert len(current) == 1
    assert current[0].source_id == source_id
    assert current[0].longitude == -21.288
    assert rows[0].is_current is False


def test_sync_summary_separates_new_events_revisions_and_history(db_session):
    first_identity = "2026-07-28 16:57:15.100"
    second_identity = "2026-07-28 16:57:19.100"
    first = sync_authoritative_rows([
        _candidate(first_identity),
        _candidate(second_identity),
    ])
    unchanged = sync_authoritative_rows([
        _candidate(first_identity),
        _candidate(second_identity),
    ])
    revised = sync_authoritative_rows([
        _candidate(first_identity, lat=64.1, depth=9.0),
        _candidate(second_identity),
    ])

    assert first["new_current_events"] == 2
    assert first["new_revisions"] == 0
    assert unchanged["new_current_events"] == 0
    assert unchanged["new_rows"] == 0
    assert unchanged["reactivated_unchanged"] == 2
    assert revised["new_current_events"] == 0
    assert revised["new_rows"] == 1
    assert revised["new_revisions"] == 1
    assert revised["retained_inactive_revisions"] == 1
    assert revised["source_current"] == 2
