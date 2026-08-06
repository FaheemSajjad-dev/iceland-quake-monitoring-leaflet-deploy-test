import { describe, expect, it, vi } from "vitest";
import {
  aggregateByTime,
  buildDepthHistogram,
  buildAnalysis,
  clampFiltersToBounds,
  filterEarthquakes,
  getDatasetBounds,
  makeDefaultFilters,
  normalizeEarthquakes,
  selectDepthRecords,
  summarizeDepthQuality,
  validateFilters,
} from "../analysis/analysisData";
import { buildEarthquakesCsv } from "../analysis/analysisExport";
import { parseBackendUtcDate } from "../utils/datetime";

const rows = [
  {
    "Date-time": "2024-01-01 12:00:00",
    Latitude: 64,
    Longitude: -21,
    Depth: 5,
    Mw_mean: 3.2,
    status: "matched",
  },
  {
    "Date-time": "2024-01-02 12:00:00",
    Latitude: 64.1,
    Longitude: -21.1,
    Depth: 15,
    Mw_mean: 4.1,
    status: "v_only",
  },
  {
    "Date-time": "2024-01-03 12:00:00",
    Latitude: 64.2,
    Longitude: -21.2,
    Depth: null,
    Mw_mean: 3.5,
    status: "v_only",
  },
];

describe("analysis transformations", () => {
  it("defaults the end date to the current system date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 20, 12));
    const bounds = getDatasetBounds(normalizeEarthquakes(rows));
    expect(bounds.endDate).toBe("2026-07-20");
    expect(makeDefaultFilters(bounds).endDate).toBe("2026-07-20");
    vi.useRealTimers();
  });

  it("defaults numeric maximums to the exact catalogue maximums", () => {
    const bounds = getDatasetBounds(normalizeEarthquakes(rows));
    const defaults = makeDefaultFilters(bounds);
    expect(defaults.maxMagnitude).toBe(4.1);
    expect(defaults.maxDepth).toBe(15);
  });

  it("keeps non-depth filtering independent from depth eligibility", () => {
    const normalized = normalizeEarthquakes(rows);
    const filtered = filterEarthquakes(normalized, {
      startDate: "2024-01-01",
      endDate: "2024-01-03",
      minMagnitude: 3,
      maxMagnitude: 5,
      minDepth: 0,
      maxDepth: 10,
      category: "mpgv_only",
    });
    expect(filtered).toHaveLength(2);
    expect(filtered.some((item) => !item.hasDepth)).toBe(true);
  });

  it("defaults depth analysis to reference records and applies depth limits only there", () => {
    const normalized = normalizeEarthquakes(rows);
    const reference = selectDepthRecords(normalized, {
      minDepth: 0,
      maxDepth: 10,
      depthQuality: "reference_only",
    });
    expect(reference.map((item) => item.depthQuality)).toEqual(["reference"]);
    expect(summarizeDepthQuality(normalized, reference)).toMatchObject({
      reference: 1,
      unverifiedIncluded: 0,
      unverifiedAvailable: 1,
      unavailable: 1,
    });
  });

  it("can include raw unverified MPGV depths", () => {
    const selected = selectDepthRecords(normalizeEarthquakes(rows), {
      minDepth: 0,
      maxDepth: 20,
      depthQuality: "include_unverified",
    });
    expect(selected.map((item) => item.depthQuality)).toEqual([
      "reference",
      "unverified_mpgv",
    ]);
  });

  it("aggregates time statistics and categories", () => {
    const normalized = normalizeEarthquakes(rows);
    const series = aggregateByTime(normalized, "month", [normalized[0]]);
    expect(series[0]).toMatchObject({
      count: 3,
      matched: 1,
      mpgv_only: 2,
      highestMagnitude: 4.1,
    });
    expect(series[0].averageDepth).toBe(5);
  });

  it("includes empty time periods through the selected end date", () => {
    const normalized = normalizeEarthquakes(rows);
    const series = aggregateByTime(normalized, "month", normalized, {
      startDate: "2024-01-01",
      endDate: "2024-03-20",
    });

    expect(series.map((item) => item.period.slice(0, 10))).toEqual([
      "2024-01-01",
      "2024-02-01",
      "2024-03-01",
    ]);
    expect(series[2]).toMatchObject({
      count: 0,
      matched: 0,
      mpgv_only: 0,
      averageMagnitude: null,
      highestMagnitude: null,
    });
  });

  it("returns safe empty summaries", () => {
    expect(buildAnalysis([], [], "day")).toMatchObject({
      count: 0,
      strongest: null,
      averageMagnitude: null,
    });
  });

  it("preserves a high MPGV depth and groups it in an overflow bin", () => {
    const high = normalizeEarthquakes([
      ...rows,
      { ...rows[1], "Date-time": "2024-01-04 12:00:00", Depth: 900 },
    ]).filter((item) => item.hasDepth);
    expect(high.at(-1).depth).toBe(900);
    const bins = buildDepthHistogram(high);
    expect(bins.at(-1)).toMatchObject({ overflow: true, unverified: 1 });
  });

  it("exports the active depth mode and raw depth provenance", () => {
    const normalized = normalizeEarthquakes(rows);
    const csv = buildEarthquakesCsv(normalized, {
      depthMode: "Matched depths only",
      depthSummary: "1 matched depth; 1 excluded",
      filters: { depthQuality: "reference_only" },
    });
    expect(csv).toContain('"Depth data","Matched depths only"');
    expect(csv).toContain("Depth_source,Depth_quality");
    expect(csv).toContain('"Quakes API","reference"');
    expect(csv).toContain('"MPGV","unverified_mpgv"');
  });

  it("validates inverted ranges", () => {
    const errors = validateFilters(
      {
        startDate: "2024-02-01",
        endDate: "2024-01-01",
        minMagnitude: 5,
        maxMagnitude: 3,
        minDepth: 20,
        maxDepth: 1,
      },
      { startDate: "2024-01-01", endDate: "2024-12-31" },
    );
    expect(errors).toMatchObject({
      date: "invalidDate",
      magnitude: "invalidMagnitude",
      depth: "invalidDepth",
    });
  });

  it("rejects negative magnitude and depth filters", () => {
    const errors = validateFilters(
      {
        startDate: "2024-01-01",
        endDate: "2024-01-03",
        minMagnitude: -1,
        maxMagnitude: 5,
        minDepth: -2,
        maxDepth: 20,
      },
      { startDate: "2024-01-01", endDate: "2024-01-03" },
    );
    expect(errors).toMatchObject({
      magnitude: "invalidMagnitude",
      depth: "invalidDepth",
    });
  });

  it("rejects magnitude and depth filters above catalogue maximums", () => {
    const errors = validateFilters(
      {
        startDate: "2024-01-01",
        endDate: "2024-01-03",
        minMagnitude: 3,
        maxMagnitude: 6,
        minDepth: 0,
        maxDepth: 30,
      },
      {
        startDate: "2024-01-01",
        endDate: "2024-01-03",
        maxMagnitude: 4.1,
        maxDepth: 15,
      },
    );
    expect(errors).toMatchObject({
      magnitude: "invalidMagnitude",
      depth: "invalidDepth",
    });
  });

  it("allows equal minimum and maximum values", () => {
    const errors = validateFilters(
      {
        startDate: "2024-01-01",
        endDate: "2024-01-03",
        minMagnitude: 4.1,
        maxMagnitude: 4.1,
        minDepth: 12.5,
        maxDepth: 12.5,
      },
      {
        startDate: "2024-01-01",
        endDate: "2024-01-03",
        minMagnitude: 3,
        maxMagnitude: 5,
        minDepth: 2,
        maxDepth: 20,
      },
    );
    expect(errors).toEqual({});
  });

  it("clamps manually entered and crossed values to catalogue bounds", () => {
    expect(clampFiltersToBounds(
      {
        minMagnitude: 9,
        maxMagnitude: 20,
        minDepth: -5,
        maxDepth: 100,
      },
      {
        minMagnitude: 3.01,
        maxMagnitude: 5.83,
        minDepth: 2.4,
        maxDepth: 40.7,
      },
    )).toMatchObject({
      minMagnitude: 5.83,
      maxMagnitude: 5.83,
      minDepth: 2.4,
      maxDepth: 40.7,
    });
  });

  it("preserves fractional UTC timestamps and orders all July 28 events", () => {
    const july28 = [
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
    ];

    expect(
      parseBackendUtcDate("2026-07-28 05:36:37.500").toISOString(),
    ).toBe("2026-07-28T05:36:37.500Z");
    const normalized = normalizeEarthquakes(july28);
    expect(normalized.every((item) => item.date.getUTCDate() === 28)).toBe(true);
    expect(
      buildAnalysis(normalized, normalized, "day").recentRows.map(
        (item) => item["Date-time"],
      ),
    ).toEqual([
      "2026-07-28 16:57:19.100",
      "2026-07-28 16:57:15.100",
      "2026-07-28 05:36:37.500",
    ]);
  });
});
