"""
Unit tests for get_monthly_data() in scrape.py.

get_monthly_data(year, month) fetches an HTML table from hraun.vedur.is and
returns a list of earthquake dicts filtered to magnitude >= 3.0.

All network calls are mocked so no real HTTP requests are made.
"""
from unittest.mock import patch, MagicMock
from scrape import get_monthly_data


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
        # Microseconds should be stripped in the output
        assert result[0]["date_time"] == "2023-06-15 12:00:00"

    def test_datetime_without_microseconds(self):
        # Format: '%Y-%m-%d %H:%M:%S'
        html = _html_table(("2023-06-15 12:00:00", "64.1", "-22.0", "5.0", "", "", "3.0", ""))
        with patch("scrape.requests.get", return_value=_make_response(html)):
            result = get_monthly_data(2023, 6)
        assert result[0]["date_time"] == "2023-06-15 12:00:00"


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
