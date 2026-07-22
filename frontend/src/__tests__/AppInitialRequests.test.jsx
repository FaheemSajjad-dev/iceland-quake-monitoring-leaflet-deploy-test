import { act, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({
  fetchEarthquakeData: vi.fn(),
  fetchVolcanoData: vi.fn(),
}));
vi.mock("../analysis/AnalysisPage", () => ({
  default: ({ earthquakes, loading, loadError }) => (
    <div data-testid="analysis-props">{`${earthquakes.length}-${loading}-${loadError}`}</div>
  ),
}));
vi.mock("../components/MapComponent", () => ({ default: () => <div /> }));
vi.mock("../components/LeftPanel", () => ({ default: () => <div /> }));
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
});
