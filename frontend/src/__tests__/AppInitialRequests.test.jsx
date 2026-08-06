import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({
  fetchEarthquakeData: vi.fn(),
  fetchVolcanoData: vi.fn(),
}));
vi.mock("../analysis/AnalysisPage", () => ({
  default: ({ earthquakes, loading, loadError, onMap, onViewMap }) => (
    <div>
      <div data-testid="analysis-props">{`${earthquakes.length}-${loading}-${loadError}`}</div>
      <label>
        Insights filter
        <input defaultValue="original filter" />
      </label>
      <button type="button" onClick={onMap}>Return to map</button>
      {earthquakes[0] && (
        <button
          type="button"
          onClick={() => onViewMap({
            ...earthquakes[0],
            latitude: Number(earthquakes[0].Latitude),
            longitude: Number(earthquakes[0].Longitude),
          })}
        >
          Show on map
        </button>
      )}
    </div>
  ),
}));
vi.mock("../components/MapComponent", () => ({
  default: ({ earthquakes, selectedEarthquake, setSelectedEarthquake, earthquakeSelectionRequestId }) => (
    <div>
      <div data-testid="map-earthquakes">
        {earthquakes.map((quake) => quake["Date-time"]).join("|")}
      </div>
      <div data-testid="selection-request-id">{earthquakeSelectionRequestId}</div>
      {selectedEarthquake && (
        <button type="button" onClick={() => setSelectedEarthquake(selectedEarthquake)}>
          Reselect earthquake
        </button>
      )}
    </div>
  ),
}));
vi.mock("../components/LeftPanel", () => ({
  default: ({ onMagnitudeFilterChange, onShowAnalysis }) => (
    <div>
      <button type="button" onClick={() => onMagnitudeFilterChange(5)}>
        Filter above five
      </button>
      <button type="button" onClick={onShowAnalysis}>Open insights</button>
    </div>
  ),
}));
vi.mock("../components/MapTypeSelector", () => ({ default: () => <div /> }));
vi.mock("../components/RightPanel", () => ({ default: () => <div /> }));
vi.mock("../components/About", () => ({ default: () => <div /> }));
vi.mock("../components/RecentSelections", () => ({ default: () => <div /> }));

import App from "../App";
import { fetchEarthquakeData, fetchVolcanoData } from "../api";

const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
};

describe("App initial request coordination", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/mpgv/analysis");
    fetchEarthquakeData.mockReset();
    fetchVolcanoData.mockReset();
  });

  it("starts earthquake and volcano requests together and ignores Strict Mode's stale run", async () => {
    const earthquakeRuns = [deferred(), deferred()];
    const volcanoRuns = [deferred(), deferred()];
    fetchEarthquakeData
      .mockImplementationOnce(() => earthquakeRuns[0].promise)
      .mockImplementationOnce(() => earthquakeRuns[1].promise);
    fetchVolcanoData
      .mockImplementationOnce(() => volcanoRuns[0].promise)
      .mockImplementationOnce(() => volcanoRuns[1].promise);

    render(<StrictMode><App /></StrictMode>);
    await waitFor(() => {
      expect(fetchEarthquakeData).toHaveBeenCalledTimes(2);
      expect(fetchVolcanoData).toHaveBeenCalledTimes(2);
    });
    expect(fetchEarthquakeData.mock.calls[0][0].aborted).toBe(true);
    expect(fetchVolcanoData.mock.calls[0][0].aborted).toBe(true);
    expect(fetchEarthquakeData.mock.calls[1][0].aborted).toBe(false);

    await act(async () => earthquakeRuns[0].resolve([{ Mw_mean: 9 }]));
    expect(screen.getByTestId("analysis-props")).toHaveTextContent("0-true-false");

    await act(async () => earthquakeRuns[1].resolve([{ Mw_mean: 4.2 }]));
    await waitFor(() => expect(screen.getByTestId("analysis-props")).toHaveTextContent("1-false-false"));

    await act(async () => {
      volcanoRuns[0].resolve([]);
      volcanoRuns[1].resolve([]);
    });
  });

  it("shows an Insights earthquake outside map filters for only 15 seconds", async () => {
    const quake = {
      "Date-time": "2026-07-28 05:36:37.500",
      Latitude: 64.661186,
      Longitude: -17.470501,
      Mw_mean: 4.2,
    };
    fetchEarthquakeData.mockResolvedValue([quake]);
    fetchVolcanoData.mockResolvedValue([]);

    render(<App />);
    await waitFor(() => expect(screen.getByTestId("analysis-props")).toHaveTextContent("1-false-false"));

    fireEvent.click(screen.getByText("Filter above five"));
    await waitFor(() => expect(screen.getByTestId("map-earthquakes")).toBeEmptyDOMElement());

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByText("Show on map"));
      expect(screen.getByTestId("map-earthquakes")).toHaveTextContent(quake["Date-time"]);

      await act(async () => vi.advanceTimersByTime(15_000));
      expect(screen.getByTestId("map-earthquakes")).toBeEmptyDOMElement();
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves Insights state after visiting the map and returning", async () => {
    fetchEarthquakeData.mockResolvedValue([]);
    fetchVolcanoData.mockResolvedValue([]);

    render(<App />);
    await waitFor(() => expect(screen.getByTestId("analysis-props")).toHaveTextContent("0-false-true"));

    const filter = screen.getByRole("textbox", { name: "Insights filter" });
    fireEvent.change(filter, { target: { value: "custom saved filter" } });
    fireEvent.click(screen.getByText("Return to map"));
    expect(filter.closest("div[hidden]")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Open insights"));
    expect(screen.getByRole("textbox", { name: "Insights filter" })).toHaveValue("custom saved filter");
  });

  it("requests a fresh ShakeMap lookup when the same earthquake is reselected", async () => {
    const quake = {
      "Date-time": "2026-03-31 07:11:02.000",
      Latitude: 64.669,
      Longitude: -17.387,
      Mw_mean: 3.8,
    };
    fetchEarthquakeData.mockResolvedValue([quake]);
    fetchVolcanoData.mockResolvedValue([]);

    render(<App />);
    await waitFor(() => expect(screen.getByTestId("analysis-props")).toHaveTextContent("1-false-false"));

    fireEvent.click(screen.getByText("Show on map"));
    expect(screen.getByTestId("selection-request-id")).toHaveTextContent("1");

    fireEvent.click(screen.getByText("Reselect earthquake"));
    expect(screen.getByTestId("selection-request-id")).toHaveTextContent("2");
  });
});
