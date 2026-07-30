import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ResultsTables from "../analysis/ResultsTables";
import {
  buildAnalysis,
  normalizeEarthquakes,
  selectDepthRecords,
} from "../analysis/analysisData";

const text = {
  results: "Results",
  recentEarthquakes: "Recent earthquakes (filtered)",
  strongestEarthquakes: "Strongest earthquakes",
  sort: "Sort",
  date: "Date",
  magnitude: "Magnitude",
  depth: "Depth",
  coordinates: "Coordinates",
  category: "Category",
  source: "Source",
  viewMap: "View on map",
  previous: "Previous",
  next: "Next",
  matched: "Matched",
  mpgvOnly: "MPGV only",
  unverifiedDepth: "Unverified",
  referenceDepth: "Reference",
  depthUnavailable: "Unavailable",
  unverifiedShort: "unverified",
};

describe("ResultsTables", () => {
  it("displays the three July 28 events in descending UTC time order", () => {
    const normalized = normalizeEarthquakes([
      {
        "Date-time": "2026-07-28 05:36:37.500",
        Latitude: 64.661186,
        Longitude: -17.470501,
        Depth: 3.5,
        Mw_mean: 5.16,
        status: "matched",
      },
      {
        "Date-time": "2026-07-28 16:57:15.100",
        Latitude: 64.136,
        Longitude: -18.6,
        Depth: 1.1,
        Mw_mean: 3.0,
        status: "v_only",
      },
      {
        "Date-time": "2026-07-28 16:57:19.100",
        Latitude: 63.994,
        Longitude: -19.123,
        Depth: 1.7,
        Mw_mean: 3.01,
        status: "v_only",
      },
    ]);
    const depthRecords = selectDepthRecords(normalized, {
      minDepth: 0,
      maxDepth: 10,
      depthQuality: "include_unverified",
    });
    const analysis = buildAnalysis(normalized, depthRecords, "day");
    render(
      <ResultsTables analysis={analysis} text={text} onViewMap={vi.fn()} />,
    );

    const heading = screen.getByRole("heading", {
      name: "Recent earthquakes (filtered)",
    });
    const card = heading.closest("article");
    const bodyRows = within(card).getAllByRole("row").slice(1);
    expect(bodyRows).toHaveLength(3);
    expect(bodyRows[0]).toHaveTextContent("63.9940, -19.1230");
    expect(bodyRows[0]).toHaveTextContent("M 3.01");
    expect(bodyRows[1]).toHaveTextContent("64.1360, -18.6000");
    expect(bodyRows[1]).toHaveTextContent("M 3.0");
    expect(bodyRows[2]).toHaveTextContent("64.6612, -17.4705");
    expect(bodyRows[2]).toHaveTextContent("M 5.16");
  });
});
