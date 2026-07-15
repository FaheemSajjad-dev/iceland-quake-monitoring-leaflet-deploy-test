import { parseBackendUtcDate } from "../utils/datetime";

export const MIN_CATALOGUE_MAGNITUDE = 3;
export const DEPTH_QUALITY = {
  REFERENCE: "reference",
  UNVERIFIED: "unverified_mpgv",
  UNAVAILABLE: "unavailable",
};

export const categoryOf = (quake) =>
  quake.status === "matched" ? "matched" : "mpgv_only";

export const depthProvenanceOf = (quake, depth) => {
  if (!Number.isFinite(depth)) {
    return {
      quality: DEPTH_QUALITY.UNAVAILABLE,
      source: null,
      hasDepth: false,
    };
  }
  if (quake.status === "matched") {
    return {
      quality: DEPTH_QUALITY.REFERENCE,
      source: "Quakes API",
      hasDepth: true,
    };
  }
  return {
    quality: DEPTH_QUALITY.UNVERIFIED,
    source: "MPGV",
    hasDepth: true,
  };
};

export const depthLabel = (item, text) => {
  if (!item.hasDepth) return text.depthUnavailable;
  const quality =
    item.depthQuality === DEPTH_QUALITY.REFERENCE
      ? text.referenceDepth
      : text.unverifiedDepth;
  return `${item.depth.toFixed(1)} km · ${item.depthSource} · ${quality}`;
};

export const normalizeEarthquakes = (rows) =>
  rows.flatMap((quake, index) => {
    const date = parseBackendUtcDate(quake["Date-time"]);
    const magnitude = Number(quake.Mw_mean);
    const rawDepth = quake.Depth;
    const depth =
      rawDepth === null || rawDepth === undefined || rawDepth === ""
        ? Number.NaN
        : Number(rawDepth);
    const latitude = Number(quake.Latitude);
    const longitude = Number(quake.Longitude);
    if (!date || !Number.isFinite(magnitude)) return [];
    const provenance = depthProvenanceOf(quake, depth);
    return [
      {
        ...quake,
        id: `${quake["Date-time"]}-${latitude}-${longitude}-${index}`,
        date,
        magnitude,
        depth: provenance.hasDepth ? depth : null,
        depthQuality: provenance.quality,
        depthSource: provenance.source,
        hasDepth: provenance.hasDepth,
        latitude,
        longitude,
        category: categoryOf(quake),
      },
    ];
  });

export const getDatasetBounds = (earthquakes) => {
  if (!earthquakes.length) return null;
  const dates = earthquakes.map((item) => item.date.getTime());
  const magnitudes = earthquakes.map((item) => item.magnitude);
  const depths = earthquakes
    .filter((item) => item.hasDepth)
    .map((item) => item.depth);
  return {
    startDate: new Date(Math.min(...dates)).toISOString().slice(0, 10),
    endDate: new Date(Math.max(...dates)).toISOString().slice(0, 10),
    minMagnitude: Math.min(...magnitudes),
    maxMagnitude: Math.max(...magnitudes),
    minDepth: depths.length ? Math.min(...depths) : 0,
    maxDepth: depths.length ? Math.max(...depths) : 100,
  };
};

export const makeDefaultFilters = (bounds) => ({
  startDate: bounds?.startDate ?? "",
  endDate: bounds?.endDate ?? "",
  minMagnitude: bounds
    ? Math.max(
        MIN_CATALOGUE_MAGNITUDE,
        Math.floor(bounds.minMagnitude * 10) / 10,
      )
    : MIN_CATALOGUE_MAGNITUDE,
  maxMagnitude: bounds ? Math.ceil(bounds.maxMagnitude * 10) / 10 : 10,
  minDepth: bounds ? Math.floor(bounds.minDepth) : 0,
  maxDepth: bounds ? Math.ceil(bounds.maxDepth) : 100,
  category: "all",
  grouping: "month",
  depthQuality: "reference_only",
});

export const validateFilters = (filters, bounds) => {
  const errors = {};
  if (
    !filters.startDate ||
    !filters.endDate ||
    filters.startDate > filters.endDate
  )
    errors.date = "invalidDate";
  if (
    !Number.isFinite(Number(filters.minMagnitude)) ||
    !Number.isFinite(Number(filters.maxMagnitude)) ||
    Number(filters.minMagnitude) > Number(filters.maxMagnitude)
  )
    errors.magnitude = "invalidMagnitude";
  if (
    !Number.isFinite(Number(filters.minDepth)) ||
    !Number.isFinite(Number(filters.maxDepth)) ||
    Number(filters.minDepth) > Number(filters.maxDepth)
  )
    errors.depth = "invalidDepth";
  if (
    bounds &&
    (filters.startDate < bounds.startDate || filters.endDate > bounds.endDate)
  )
    errors.range = "outsideRange";
  return errors;
};

export const filterEarthquakes = (earthquakes, filters) => {
  const start = new Date(`${filters.startDate}T00:00:00Z`).getTime();
  const end = new Date(`${filters.endDate}T23:59:59.999Z`).getTime();
  return earthquakes.filter((item) => {
    const time = item.date.getTime();
    return (
      time >= start &&
      time <= end &&
      item.magnitude >= Number(filters.minMagnitude) &&
      item.magnitude <= Number(filters.maxMagnitude) &&
      (filters.category === "all" || item.category === filters.category)
    );
  });
};

export const selectDepthRecords = (earthquakes, filters) =>
  earthquakes.filter(
    (item) =>
      item.hasDepth &&
      (item.depthQuality === DEPTH_QUALITY.REFERENCE ||
        filters.depthQuality === "include_unverified") &&
      item.depth >= Number(filters.minDepth) &&
      item.depth <= Number(filters.maxDepth),
  );

export const summarizeDepthQuality = (earthquakes, depthRecords) => ({
  reference: depthRecords.filter(
    (item) => item.depthQuality === DEPTH_QUALITY.REFERENCE,
  ).length,
  unverifiedIncluded: depthRecords.filter(
    (item) => item.depthQuality === DEPTH_QUALITY.UNVERIFIED,
  ).length,
  unverifiedAvailable: earthquakes.filter(
    (item) => item.depthQuality === DEPTH_QUALITY.UNVERIFIED,
  ).length,
  unavailable: earthquakes.filter(
    (item) => item.depthQuality === DEPTH_QUALITY.UNAVAILABLE,
  ).length,
});

const periodStart = (date, grouping) => {
  const value = new Date(date);
  value.setUTCHours(0, 0, 0, 0);
  if (grouping === "week")
    value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
  if (grouping === "month" || grouping === "year") value.setUTCDate(1);
  if (grouping === "year") value.setUTCMonth(0);
  return value;
};

export const aggregateByTime = (
  earthquakes,
  grouping,
  depthRecords = earthquakes,
) => {
  const eligibleDepthIds = new Set(depthRecords.map((item) => item.id));
  const buckets = new Map();
  earthquakes.forEach((item) => {
    const start = periodStart(item.date, grouping);
    const key = start.toISOString();
    const bucket = buckets.get(key) ?? {
      period: key,
      timestamp: start.getTime(),
      count: 0,
      magnitudeTotal: 0,
      depthTotal: 0,
      highestMagnitude: -Infinity,
      matched: 0,
      mpgv_only: 0,
    };
    bucket.count += 1;
    bucket.magnitudeTotal += item.magnitude;
    if (eligibleDepthIds.has(item.id)) {
      bucket.depthTotal += item.depth;
      bucket.depthCount = (bucket.depthCount ?? 0) + 1;
    }
    bucket.highestMagnitude = Math.max(bucket.highestMagnitude, item.magnitude);
    bucket[item.category] += 1;
    buckets.set(key, bucket);
  });
  return [...buckets.values()]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((bucket) => ({
      ...bucket,
      averageMagnitude: bucket.magnitudeTotal / bucket.count,
      averageDepth: bucket.depthCount
        ? bucket.depthTotal / bucket.depthCount
        : null,
    }));
};

const histogram = (earthquakes, key, size, floor = 0) => {
  const buckets = new Map();
  earthquakes.forEach((item) => {
    const start = Math.floor((item[key] - floor) / size) * size + floor;
    const bucketKey = Number(start.toFixed(2));
    const bucket = buckets.get(bucketKey) ?? {
      start: bucketKey,
      end: Number((start + size).toFixed(2)),
      count: 0,
      maximum: -Infinity,
    };
    bucket.count += 1;
    bucket.maximum = Math.max(bucket.maximum, item[key]);
    buckets.set(bucketKey, bucket);
  });
  return [...buckets.values()]
    .sort((a, b) => a.start - b.start)
    .map((item) => ({
      ...item,
      range: `${item.start.toFixed(1)}–${item.end.toFixed(1)}`,
      percentage: earthquakes.length
        ? (item.count / earthquakes.length) * 100
        : 0,
    }));
};

const percentile = (values, fraction) => {
  if (!values.length) return null;
  const index = (values.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return values[lower] + (values[upper] - values[lower]) * (index - lower);
};

export const buildDepthHistogram = (earthquakes) => {
  if (!earthquakes.length) return [];
  const depths = earthquakes.map((item) => item.depth).sort((a, b) => a - b);
  const q1 = percentile(depths, 0.25);
  const q3 = percentile(depths, 0.75);
  const median = percentile(depths, 0.5);
  const outlierLimit = median + Math.max(25, 4 * Math.max(median - q1, 1));
  const displayMax = Math.min(
    depths.at(-1),
    Math.max(outlierLimit, q3 > outlierLimit ? median + 25 : q3 + 5),
  );
  const displayMin = depths[0];
  const binSize = Math.max(
    1,
    Math.ceil((displayMax - displayMin) / 10 / 5) * 5,
  );
  const first = Math.floor(displayMin / binSize) * binSize;
  const binCount = Math.max(1, Math.ceil((displayMax - first) / binSize));
  const bins = Array.from({ length: binCount }, (_, index) => ({
    start: first + index * binSize,
    end: first + (index + 1) * binSize,
    reference: 0,
    unverified: 0,
    overflow: false,
  }));
  const hasOverflow = depths.some((depth) => depth > displayMax);
  if (hasOverflow) {
    bins.push({
      start: bins.at(-1).end,
      end: null,
      reference: 0,
      unverified: 0,
      overflow: true,
    });
  }
  earthquakes.forEach((item) => {
    const index =
      item.depth > displayMax
        ? bins.length - 1
        : Math.min(Math.floor((item.depth - first) / binSize), binCount - 1);
    const key =
      item.depthQuality === DEPTH_QUALITY.REFERENCE
        ? "reference"
        : "unverified";
    bins[index][key] += 1;
  });
  return bins.map((bin) => ({
    ...bin,
    count: bin.reference + bin.unverified,
    range: bin.overflow
      ? `>${bin.start.toFixed(0)} km`
      : `${bin.start.toFixed(0)}–${bin.end.toFixed(0)} km`,
  }));
};

export const buildAnalysis = (earthquakes, depthRecords, grouping) => {
  const sortedByMagnitude = [...earthquakes].sort(
    (a, b) => b.magnitude - a.magnitude,
  );
  const sortedRecent = [...earthquakes].sort((a, b) => b.date - a.date);
  const count = earthquakes.length;
  const totalMagnitude = earthquakes.reduce(
    (sum, item) => sum + item.magnitude,
    0,
  );
  const totalDepth = depthRecords.reduce((sum, item) => sum + item.depth, 0);
  const matched = earthquakes.filter(
    (item) => item.category === "matched",
  ).length;
  const mpgvOnly = count - matched;
  return {
    count,
    strongest: sortedByMagnitude[0] ?? null,
    averageMagnitude: count ? totalMagnitude / count : null,
    averageDepth: depthRecords.length ? totalDepth / depthRecords.length : null,
    shallowest: depthRecords.length
      ? depthRecords.reduce((a, b) => (a.depth < b.depth ? a : b))
      : null,
    deepest: depthRecords.length
      ? depthRecords.reduce((a, b) => (a.depth > b.depth ? a : b))
      : null,
    matched,
    mpgvOnly,
    timeSeries: aggregateByTime(earthquakes, grouping, depthRecords),
    magnitudeBins: histogram(
      earthquakes,
      "magnitude",
      0.2,
      MIN_CATALOGUE_MAGNITUDE,
    ),
    depthBins: buildDepthHistogram(depthRecords),
    depthRecords,
    depthQuality: summarizeDepthQuality(earthquakes, depthRecords),
    strongestRows: sortedByMagnitude.slice(0, 50),
    recentRows: sortedRecent.slice(0, 50),
  };
};
