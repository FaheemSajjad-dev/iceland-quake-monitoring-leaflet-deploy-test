import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  Brush,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import ChartCard from "./ChartCard";

const COLORS = {
  blue: "#1368aa",
  orange: "#e65f2b",
  teal: "#16877b",
  purple: "#7b61a8",
};
const periodLabel = (value, locale) =>
  new Date(value).toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
const accessiblePeriodLabel = (value, locale) =>
  new Date(value).toLocaleDateString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
const tooltipStyle = {
  border: "1px solid #d9e2ec",
  borderRadius: 8,
  boxShadow: "0 6px 20px rgba(20,40,70,.12)",
};

const TimeTooltip = ({ active, payload, text }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="analysis-tooltip">
      <strong>{periodLabel(row.period, text.locale)}</strong>
      <span>
        {text.count}: {row.count}
      </span>
      <span>
        {text.highestMagnitude}: {row.highestMagnitude.toFixed(1)}
      </span>
      <span>
        {text.averageMagnitude}: {row.averageMagnitude.toFixed(2)}
      </span>
      <span>
        {text.averageDepth}:{" "}
        {row.averageDepth == null ? "—" : `${row.averageDepth.toFixed(1)} km`}
      </span>
    </div>
  );
};

const BinTooltip = ({ active, payload, text }) =>
  active && payload?.length ? (
    <div className="analysis-tooltip">
      <strong>{payload[0].payload.range}</strong>
      <span>
        {text.count}: {payload[0].payload.count}
      </span>
      <span>
        {text.percentage}: {payload[0].payload.percentage.toFixed(1)}%
      </span>
      <span>
        {text.maximum}: {payload[0].payload.maximum.toFixed(1)}
      </span>
    </div>
  ) : null;
const ScatterTooltip = ({ active, payload, text }) => {
  const row = payload?.[0]?.payload;
  return active && row ? (
    <div className="analysis-tooltip">
      <strong>M {row.magnitude.toFixed(1)}</strong>
      <span>
        {text.depth}: {row.depth.toFixed(1)} km
      </span>
      <span>{row.date.toLocaleString()}</span>
      <span>
        {row.latitude.toFixed(4)}, {row.longitude.toFixed(4)}
      </span>
      <span>{row.category === "matched" ? text.matched : text.mpgvOnly}</span>
      <span>
        {text.depthSource}: {row.depthSource}
      </span>
      <span>
        {text.depthQualityLabel}:{" "}
        {row.depthQuality === "reference"
          ? text.referenceDepth
          : text.unverifiedDepth}
      </span>
    </div>
  ) : null;
};

const useTimeRange = (data) => {
  const [range, setRange] = useState(() => ({
    startIndex: 0,
    endIndex: Math.max(0, data.length - 1),
  }));
  useEffect(() => {
    setRange({ startIndex: 0, endIndex: Math.max(0, data.length - 1) });
  }, [data]);
  const onChange = (next) => {
    if (
      Number.isInteger(next?.startIndex) &&
      Number.isInteger(next?.endIndex)
    )
      setRange(next);
  };
  return { ...range, onChange };
};

const TimeRangeLabels = ({ data, range, text }) => {
  const start = data[range.startIndex]?.period;
  const end = data[range.endIndex]?.period;
  if (!start || !end) return null;
  return (
    <div className="time-range-labels" aria-live="polite">
      <span>
        <strong>{text.rangeStart}:</strong> {periodLabel(start, text.locale)}
      </span>
      <span>
        <strong>{text.rangeEnd}:</strong> {periodLabel(end, text.locale)}
      </span>
    </div>
  );
};

const brushAriaLabel = (data, range, text) => {
  const start = data[range.startIndex]?.period;
  const end = data[range.endIndex]?.period;
  if (!start || !end) return undefined;
  return `${text.rangeStart}: ${accessiblePeriodLabel(start, text.locale)}; ${text.rangeEnd}: ${accessiblePeriodLabel(end, text.locale)}`;
};

export const TimeChart = ({ data, metric, color, text, children }) => {
  const highest = data.reduce(
    (best, row) => (!best || row[metric] > best[metric] ? row : best),
    null,
  );
  const range = useTimeRange(data);
  return (
    <div className="time-chart-with-range">
      <div className="time-chart-plot">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 18, right: 18, left: 0, bottom: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="period"
              tickFormatter={(value) => periodLabel(value, text.locale)}
              minTickGap={35}
            />
            <YAxis width={42} />
            <Tooltip
              content={<TimeTooltip text={text} />}
              cursor={{ stroke: "#627d98" }}
              wrapperStyle={tooltipStyle}
            />
            <Line
              type="monotone"
              dataKey={metric}
              stroke={color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 6 }}
              isAnimationActive={false}
            />
            {highest && (
              <ReferenceDot
                x={highest.period}
                y={highest[metric]}
                r={4}
                fill={color}
                stroke="#fff"
              />
            )}
            {children}
            <Brush
              dataKey="period"
              tickFormatter={() => ""}
              height={24}
              travellerWidth={8}
              startIndex={range.startIndex}
              endIndex={range.endIndex}
              onChange={range.onChange}
              ariaLabel={brushAriaLabel(data, range, text)}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <TimeRangeLabels data={data} range={range} text={text} />
    </div>
  );
};

export const CategoryTimeChart = ({ data, includeUnverified, text }) => {
  const range = useTimeRange(data);
  return (
    <div className="time-chart-with-range">
      <div className="time-chart-plot">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 18, right: 18, left: 0, bottom: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="period"
              tickFormatter={(value) => periodLabel(value, text.locale)}
              minTickGap={35}
            />
            <YAxis width={42} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(value) => periodLabel(value, text.locale)}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="matched"
              name={text.matched}
              stroke={COLORS.teal}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
            {includeUnverified && (
              <Line
                type="monotone"
                dataKey="mpgv_only"
                name={text.mpgvOnly}
                stroke={COLORS.orange}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 5 }}
                isAnimationActive={false}
              />
            )}
            <Brush
              dataKey="period"
              tickFormatter={() => ""}
              height={24}
              travellerWidth={8}
              startIndex={range.startIndex}
              endIndex={range.endIndex}
              onChange={range.onChange}
              ariaLabel={brushAriaLabel(data, range, text)}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <TimeRangeLabels data={data} range={range} text={text} />
    </div>
  );
};

const DepthBinTooltip = ({ active, payload, text, showUnverified }) => {
  const row = payload?.[0]?.payload;
  return active && row ? (
    <div className="analysis-tooltip">
      <strong>{row.range}</strong>
      <span>
        {text.referenceDepth}: {row.reference}
      </span>
      {showUnverified && (
        <span>
          {text.unverifiedDepth}: {row.unverified}
        </span>
      )}
      <span>
        {text.count}: {row.count}
      </span>
    </div>
  ) : null;
};

export default function AnalysisCharts({
  analysis,
  depthRecords,
  includeUnverified,
  text,
}) {
  const [zoomKey, setZoomKey] = useState(0);
  const resetZoom = () => setZoomKey((value) => value + 1);
  const series = analysis.timeSeries;
  const showUnverified = depthRecords.some(
    (item) => item.depthQuality === "unverified_mpgv",
  );
  return (
    <section className="charts-grid" aria-label={text.charts}>
      <ChartCard
        id="magnitude-distribution"
        title={text.magnitudeDistribution}
        text={text}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={analysis.magnitudeBins}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="range" minTickGap={20} />
            <YAxis width={42} />
            <Tooltip content={<BinTooltip text={text} />} />
            <Bar dataKey="count" fill={COLORS.orange} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard
        id="depth-distribution"
        title={text.depthDistribution}
        text={text}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={analysis.depthBins}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="range" />
            <YAxis width={42} />
            <Tooltip
              content={
                <DepthBinTooltip
                  text={text}
                  showUnverified={showUnverified}
                />
              }
            />
            <Legend />
            <Bar
              dataKey="reference"
              name={text.referenceDepth}
              stackId="depth"
              fill={COLORS.teal}
            />
            {showUnverified && (
              <Bar
                dataKey="unverified"
                name={text.unverifiedDepth}
                stackId="depth"
                fill={COLORS.orange}
                radius={[4, 4, 0, 0]}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard
        id="magnitude-depth"
        title={text.magnitudeDepth}
        text={text}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ right: 18 }}>
            <CartesianGrid />
            <XAxis type="number" dataKey="depth" name={text.depth} unit=" km" />
            <YAxis
              type="number"
              dataKey="magnitude"
              name={text.magnitude}
              domain={["dataMin - 0.1", "dataMax + 0.1"]}
            />
            <ZAxis range={[35, 35]} />
            <Tooltip content={<ScatterTooltip text={text} />} />
            <Legend />
            <Scatter
              name={text.referenceDepth}
              data={depthRecords.filter(
                (item) => item.depthQuality === "reference",
              )}
              fill={COLORS.teal}
              isAnimationActive={false}
            />
            {showUnverified && (
              <Scatter
                name={text.unverifiedDepth}
                data={depthRecords.filter(
                  (item) => item.depthQuality === "unverified_mpgv",
                )}
                fill={COLORS.orange}
                shape="diamond"
                isAnimationActive={false}
              />
            )}
          </ScatterChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard
        id="average-magnitude-time"
        title={text.averageMagnitudeTime}
        text={text}
        onResetZoom={resetZoom}
      >
        <TimeChart
          key={`average-${zoomKey}`}
          data={series}
          metric="averageMagnitude"
          color={COLORS.purple}
          text={text}
        />
      </ChartCard>
      <ChartCard
        id="category-time"
        title={text.categoryTime}
        text={text}
        onResetZoom={resetZoom}
      >
        <CategoryTimeChart
          key={`category-${zoomKey}`}
          data={series}
          includeUnverified={includeUnverified}
          text={text}
        />
      </ChartCard>
    </section>
  );
}
