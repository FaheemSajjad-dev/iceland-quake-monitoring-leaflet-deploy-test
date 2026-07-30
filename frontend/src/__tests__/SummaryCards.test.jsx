import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import SummaryCards from "../analysis/SummaryCards";

describe("SummaryCards", () => {
  it("preserves the strongest earthquake source magnitude", () => {
    render(
      <SummaryCards
        analysis={{
          count: 1,
          strongest: {
            magnitude: 5.83,
            date: new Date(2020, 5, 21),
          },
          averageMagnitude: 5.83,
          averageDepth: 9.8,
          shallowest: { depth: 9.8 },
          deepest: { depth: 9.8 },
          matched: 1,
          mpgvOnly: 0,
        }}
        text={{
          summary: "Summary statistics",
          total: "Total earthquakes",
          strongest: "Strongest earthquake",
          averageMagnitude: "Average magnitude",
          averageDepth: "Average depth",
          shallowest: "Shallowest",
          deepest: "Deepest",
          matched: "Matched",
          mpgvOnly: "MPGV-only",
        }}
      />,
    );

    expect(screen.getByText(/M 5\.83/)).toBeInTheDocument();
  });
});
