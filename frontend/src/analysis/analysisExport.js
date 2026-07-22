const download = (blob, filename) => {
  if (!blob?.size) throw new Error("The export file could not be created.");
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch (error) {
    throw new Error("The browser could not start the download.", { cause: error });
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
};

const csvCell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;

const metadataLines = (context) => {
  if (!context) return [];
  return [
    ["Exported", new Date().toISOString()],
    ["Depth data", context.depthMode],
    ["Depth summary", context.depthSummary],
    ["Active filters", JSON.stringify(context.filters)],
  ].map((row) => row.map(csvCell).join(","));
};

export const buildEarthquakesCsv = (rows, context) => {
  const header = [
    "Date-time",
    "Latitude",
    "Longitude",
    "Depth_km",
    "Mw_mean",
    "Category",
    "Source",
    "Depth_source",
    "Depth_quality",
  ];
  const lines = rows.map((item) =>
    [
      item["Date-time"],
      item.latitude,
      item.longitude,
      item.hasDepth ? item.depth : "",
      item.magnitude,
      item.category,
      item.category === "matched" ? "MPGV + IMO Quakes API" : "MPGV",
      item.depthSource ?? "",
      item.depthQuality,
    ].map(csvCell).join(","),
  );
  return `\uFEFF${metadataLines(context).join("\n")}\n\n${header.join(",")}\n${lines.join("\n")}`;
};

export const exportEarthquakesCsv = (
  rows,
  context,
  filename = "mpgv-earthquake-insights.csv",
) => download(
  new Blob([buildEarthquakesCsv(rows, context)], { type: "text/csv;charset=utf-8" }),
  filename,
);
