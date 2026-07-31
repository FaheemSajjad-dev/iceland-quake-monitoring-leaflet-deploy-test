import { describe, expect, it } from "vitest";
import {
  getCatalogueDisplayMagnitudeMaximum,
  getDisplayMagnitudeMaximum,
} from "../utils/magnitude";

describe("display magnitude maximum", () => {
  it.each([
    [5.83, 6],
    [5.99, 6],
    [6.00, 6],
    [6.01, 7],
    [6.50, 7],
    [6.99, 7],
    [7.00, 7],
    [7.01, 8],
  ])("maps catalogue maximum %s to display maximum %s", (actual, displayed) => {
    expect(getDisplayMagnitudeMaximum(actual)).toBe(displayed);
    expect(displayed).toBeGreaterThanOrEqual(actual);
  });

  it("recalculates from the current catalogue and ignores invalid records", () => {
    expect(getCatalogueDisplayMagnitudeMaximum([
      { Mw_mean: 5.83 },
      { Mw_mean: null },
      { Mw_mean: "unknown" },
    ])).toBe(6);

    expect(getCatalogueDisplayMagnitudeMaximum([
      { Mw_mean: 5.83 },
      { Mw_mean: "6.01" },
    ])).toBe(7);
  });

  it("uses 6.0 when the catalogue has no valid magnitudes", () => {
    expect(getCatalogueDisplayMagnitudeMaximum([])).toBe(6);
  });
});
