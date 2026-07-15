const download = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const csvCell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;

const metadataLines = (context) => {
  if (!context) return [];
  return [
    ["Exported", new Date().toISOString()],
    ["Depth analysis", context.depthMode],
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
    ]
      .map(csvCell)
      .join(","),
  );
  return `\uFEFF${metadataLines(context).join("\n")}\n\n${header.join(",")}\n${lines.join("\n")}`;
};

export const exportEarthquakesCsv = (
  rows,
  context,
  filename = "mpgv-analysis.csv",
) => {
  download(
    new Blob([buildEarthquakesCsv(rows, context)], {
      type: "text/csv;charset=utf-8",
    }),
    filename,
  );
};

export const exportRowsCsv = (rows, filename, context) => {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]).filter(
    (key) => !["date", "id"].includes(key),
  );
  const lines = rows.map((row) =>
    keys.map((key) => csvCell(row[key])).join(","),
  );
  download(
    new Blob(
      [
        `\uFEFF${metadataLines(context).join("\n")}\n\n${keys.join(",")}\n${lines.join("\n")}`,
      ],
      {
        type: "text/csv;charset=utf-8",
      },
    ),
    filename,
  );
};

const chartSvg = (element) => element?.querySelector("svg.recharts-surface");

const addSvgMetadata = (svg, metadata) => {
  if (!metadata) return;
  const description = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "desc",
  );
  description.textContent = `${metadata.depthSummary} Active filters: ${JSON.stringify(metadata.filters)}`;
  svg.prepend(description);
};

export const saveChartSvg = (element, filename, metadata) => {
  const svg = chartSvg(element);
  if (!svg) return;
  const copy = svg.cloneNode(true);
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  addSvgMetadata(copy, metadata);
  download(
    new Blob([new XMLSerializer().serializeToString(copy)], {
      type: "image/svg+xml",
    }),
    filename,
  );
};

export const saveChartPng = (element, filename, metadata) => {
  const svg = chartSvg(element);
  if (!svg) return;
  const bounds = svg.getBoundingClientRect();
  const copy = svg.cloneNode(true);
  addSvgMetadata(copy, metadata);
  const source = new XMLSerializer().serializeToString(copy);
  const image = new Image();
  const url = URL.createObjectURL(
    new Blob([source], { type: "image/svg+xml" }),
  );
  image.onload = () => {
    const canvas = document.createElement("canvas");
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const footerHeight = metadata ? 48 : 0;
    canvas.width = Math.max(1, bounds.width * ratio);
    canvas.height = Math.max(1, (bounds.height + footerHeight) * ratio);
    const context = canvas.getContext("2d");
    context.scale(ratio, ratio);
    context.fillStyle = "#fff";
    context.fillRect(0, 0, bounds.width, bounds.height + footerHeight);
    context.drawImage(image, 0, 0, bounds.width, bounds.height);
    if (metadata) {
      context.fillStyle = "#334e68";
      context.font = "12px sans-serif";
      context.fillText(metadata.depthMode, 8, bounds.height + 18);
      context.fillText(metadata.depthSummary, 8, bounds.height + 36);
    }
    canvas.toBlob((blob) => blob && download(blob, filename), "image/png");
    URL.revokeObjectURL(url);
  };
  image.src = url;
};
