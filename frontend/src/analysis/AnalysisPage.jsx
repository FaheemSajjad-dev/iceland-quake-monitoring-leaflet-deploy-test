import { useCallback, useEffect, useMemo, useState } from "react";
import About from "../components/About";
import {
  DEPTH_POLICIES,
  fetchInsightsLimits,
  normalizeLimitsResponse,
} from "../api";
import { useLang } from "../i18n";
import AnalysisFilters from "./AnalysisFilters";
import AnalysisCharts from "./AnalysisCharts";
import ResultsTables from "./ResultsTables";
import SummaryCards from "./SummaryCards";
import {
  buildAnalysis,
  clampFiltersToBounds,
  filterEarthquakes,
  getDatasetBounds,
  makeDefaultFilters,
  normalizeEarthquakes,
  selectDepthRecords,
  validateFilters,
} from "./analysisData";
import { exportEarthquakesCsv } from "./analysisExport";
import "./AnalysisPage.css";

const COPY = {
  en: {
    locale: "en-GB",
    analysis: "Earthquake Insights",
    map: "Home / Map",
    about: "About",
    filters: "Filters",
    startDate: "Start date",
    endDate: "End date",
    minMagnitude: "Minimum magnitude",
    maxMagnitude: "Maximum magnitude",
    minDepth: "Minimum depth (km)",
    maxDepth: "Maximum depth (km)",
    category: "Data category",
    grouping: "Time grouping",
    depthQuality: "Depth quality",
    referenceOnly: "Matched depths only",
    includeUnverified: "Include unverified MPGV depths",
    depthFilterHint:
      "Depth limits apply only to depths included in depth statistics.",
    referenceDepth: "Matched depth",
    unverifiedDepth: "Unverified MPGV depth",
    unverifiedShort: "unverified",
    depthUnavailable: "Depth unavailable",
    depthSource: "Depth source",
    depthQualityLabel: "Depth quality",
    unverifiedWarning:
      "MPGV-only depth values may contain unreliable outliers. Raw values are unchanged.",
    depthReferenceSummary:
      "Depth statistics use {reference} matched depth values. {excluded} MPGV-only depth values are excluded.",
    depthIncludedSummary:
      "Depth statistics use {reference} matched and {included} unverified MPGV depth values.",
    all: "All",
    matched: "Matched",
    mpgvOnly: "MPGV-only",
    day: "Day",
    week: "Week",
    month: "Month",
    year: "Year",
    apply: "Apply filters",
    reset: "Reset filters",
    invalidDate: "Start date must be on or before the end date.",
    invalidMagnitude:
      "Magnitudes must stay between zero and the catalogue maximum, and minimum cannot exceed maximum.",
    invalidDepth:
      "Depths must stay between zero and the catalogue maximum, and minimum cannot exceed maximum.",
    outsideRange: "Dates must stay within the available catalogue range.",
    loading: "Loading earthquake insights…",
    loadError: "Earthquake data could not be loaded. Try again shortly.",
    noResults: "No earthquakes match these filters.",
    noEligibleDepths:
      "No eligible depth values are available for this depth-quality selection.",
    limitsLoadError: "Filter limits could not be loaded. Try again shortly.",
    retryLimits: "Retry",
    summary: "Summary statistics",
    total: "Total earthquakes",
    strongest: "Strongest earthquake",
    averageMagnitude: "Average magnitude",
    averageDepth: "Average depth",
    shallowest: "Shallowest",
    deepest: "Deepest",
    charts: "Interactive charts",
    overTime: "Earthquakes over time",
    magnitudeDistribution: "Magnitude distribution",
    depthDistribution: "Depth distribution",
    magnitudeDepth: "Magnitude versus depth",
    averageMagnitudeTime: "Average magnitude over time",
    categoryTime: "Earthquakes by data category over time",
    count: "Earthquake count",
    highestMagnitude: "Highest magnitude",
    percentage: "Percentage",
    maximum: "Maximum",
    depth: "Depth",
    magnitude: "Magnitude",
    resetZoom: "Reset zoom",
    rangeStart: "Start",
    rangeEnd: "End",
    results: "Results tables",
    strongestEarthquakes: "Strongest earthquakes (filtered)",
    recentEarthquakes: "Recent earthquakes (filtered)",
    date: "Date and time",
    coordinates: "Coordinates",
    source: "Source",
    viewMap: "View on map",
    sort: "Sort by ",
    previous: "Previous",
    next: "Next",
    exportAnalysis: "Export Insights",
    downloadCsv: "Download filtered CSV",
    printPdf: "Save PDF",
    analysisNotes: "Analysis Notes",
    analysisNotesText:
      'All charts, statistics, and tables reflect the currently selected filters. "Recent earthquakes" and "Strongest earthquakes" display results from the filtered earthquake catalogue. Depth-related analyses follow the selected depth-quality policy.',
    dataSources: "Data sources:",
    universityOfIceland: "University of Iceland",
    showing:
      "Showing {count} earthquakes from {start} to {end} with magnitude {minMag}–{maxMag}. Depth range: {minDepth}–{maxDepth} km.",
    language: "Íslenska",
  },
  is: {
    locale: "is-IS",
    depthQuality: "Gæði dýpis",
    referenceOnly: "Aðeins samsvöruð dýpi",
    includeUnverified: "Taka með óstaðfest MPGV-dýpi",
    depthFilterHint:
      "Dýptarmörk eiga aðeins við gögn sem taka þátt í dýptargreiningu.",
    referenceDepth: "Samsvarað dýpi",
    unverifiedDepth: "Óstaðfest MPGV-dýpi",
    unverifiedShort: "óstaðfest",
    depthUnavailable: "Dýpi ekki tiltækt",
    depthSource: "Uppruni dýpis",
    depthQualityLabel: "Gæði dýpis",
    unverifiedWarning:
      "MPGV-dýpi geta innihaldið óáreiðanleg frávik. Hráum gildum er ekki breytt.",
    depthReferenceSummary:
      "Dýptargreining notar {reference} samsvöruð dýpi. {excluded} MPGV-dýpi eru undanskilin.",
    depthIncludedSummary:
      "Dýptargreining notar {reference} samsvöruð dýpi og {included} óstaðfest MPGV-dýpi.",
    analysis: "Jarðskjálftayfirlit",
    map: "Heim / Kort",
    about: "Um verkefnið",
    filters: "Síur",
    startDate: "Upphafsdagur",
    endDate: "Lokadagur",
    minMagnitude: "Lágmarksstærð",
    maxMagnitude: "Hámarksstærð",
    minDepth: "Minnsta dýpi (km)",
    maxDepth: "Mesta dýpi (km)",
    category: "Gagnaflokkur",
    grouping: "Tímahópun",
    all: "Allt",
    matched: "Samsvarað",
    mpgvOnly: "Aðeins MPGV",
    day: "Dagur",
    week: "Vika",
    month: "Mánuður",
    year: "Ár",
    apply: "Nota síur",
    reset: "Endurstilla",
    invalidDate: "Upphafsdagur þarf að vera á undan lokadegi.",
    invalidMagnitude:
      "Stærðir verða að vera milli nulls og hámarks gagnasafnsins og lágmark má ekki vera hærra en hámark.",
    invalidDepth:
      "Dýpi verða að vera milli nulls og hámarks gagnasafnsins og lágmark má ekki vera hærra en hámark.",
    outsideRange: "Dagsetningar þurfa að vera innan gagnatímabilsins.",
    loading: "Hleð jarðskjálftayfirliti…",
    loadError: "Ekki tókst að hlaða jarðskjálftagögnum.",
    noResults: "Engir jarðskjálftar passa við síurnar.",
    noEligibleDepths:
      "Engin gjaldgeng dýptargildi eru tiltæk fyrir þetta val á gæðum dýpis.",
    limitsLoadError: "Ekki tókst að hlaða mörkum sía.",
    retryLimits: "Reyna aftur",
    summary: "Samantekt",
    total: "Jarðskjálftar alls",
    strongest: "Stærsti jarðskjálfti",
    averageMagnitude: "Meðalstærð",
    averageDepth: "Meðaldýpi",
    shallowest: "Grynnsti",
    deepest: "Dýpsti",
    charts: "Gagnvirk gröf",
    overTime: "Jarðskjálftar eftir tíma",
    magnitudeDistribution: "Dreifing stærðar",
    depthDistribution: "Dreifing dýpis",
    magnitudeDepth: "Stærð á móti dýpi",
    averageMagnitudeTime: "Meðalstærð eftir tíma",
    categoryTime: "Gagnaflokkar eftir tíma",
    count: "Fjöldi",
    highestMagnitude: "Mesta stærð",
    percentage: "Hlutfall",
    maximum: "Hámark",
    depth: "Dýpi",
    magnitude: "Stærð",
    resetZoom: "Endurstilla aðdrátt",
    rangeStart: "Upphaf",
    rangeEnd: "Endir",
    results: "Niðurstöður",
    strongestEarthquakes: "Stærstu jarðskjálftar (síaðir)",
    recentEarthquakes: "Nýlegir jarðskjálftar (síaðir)",
    date: "Dagsetning og tími",
    coordinates: "Hnit",
    source: "Uppruni",
    viewMap: "Skoða á korti",
    sort: "Raða eftir ",
    previous: "Fyrri",
    next: "Næsta",
    exportAnalysis: "Flytja út yfirlit",
    downloadCsv: "Sækja síað CSV",
    printPdf: "Vista PDF",
    analysisNotes: "Athugasemdir um greiningu",
    analysisNotesText:
      "Öll gröf, tölfræði og töflur endurspegla valdar síur. „Nýlegir jarðskjálftar“ og „Stærstu jarðskjálftar“ sýna niðurstöður úr síaðri jarðskjálftaskrá. Dýptargreiningar fylgja valinni stefnu um gæði dýpis.",
    dataSources: "Gagnaheimildir:",
    universityOfIceland: "Háskóli Íslands",
    showing:
      "Sýni {count} jarðskjálfta frá {start} til {end}, stærð {minMag}–{maxMag}. Dýptargreining: {minDepth}–{maxDepth} km.",
    language: "English",
  },
};

const SkeletonBlock = ({ className = "" }) => (
  <span className={`analysis-skeleton-block ${className}`} aria-hidden="true" />
);

const AnalysisSkeleton = ({ text }) => (
  <div className="analysis-initial-skeleton" data-testid="analysis-skeleton" role="status" aria-label={text.loading}>
    <section className="analysis-filters analysis-skeleton-filters" aria-hidden="true">
      <SkeletonBlock className="analysis-skeleton-heading" />
      <div className="analysis-skeleton-filter-grid">
        {Array.from({ length: 8 }, (_, index) => (
          <div className="analysis-skeleton-field" key={index}>
            <SkeletonBlock className="analysis-skeleton-label" />
            <SkeletonBlock className="analysis-skeleton-input" />
          </div>
        ))}
      </div>
    </section>
    <div className="summary-grid analysis-skeleton-summary" aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => (
        <div className="summary-card" key={index}>
          <SkeletonBlock className="analysis-skeleton-label" />
          <SkeletonBlock className="analysis-skeleton-value" />
        </div>
      ))}
    </div>
    <div className="charts-grid analysis-skeleton-charts" aria-hidden="true">
      {Array.from({ length: 5 }, (_, index) => (
        <div className="chart-card analysis-skeleton-chart" key={index}>
          <SkeletonBlock className="analysis-skeleton-chart-title" />
          <SkeletonBlock className="analysis-skeleton-plot" />
        </div>
      ))}
    </div>
    <div className="results-grid analysis-skeleton-results" aria-hidden="true">
      {Array.from({ length: 2 }, (_, index) => (
        <div className="results-card analysis-skeleton-table" key={index}>
          <SkeletonBlock className="analysis-skeleton-chart-title" />
          {Array.from({ length: 5 }, (_, row) => (
            <SkeletonBlock className="analysis-skeleton-row" key={row} />
          ))}
        </div>
      ))}
    </div>
  </div>
);

export default function AnalysisPage({
  earthquakes,
  loading,
  loadError,
  onRetryData,
  onMap,
  onViewMap,
}) {
  const { lang, toggleLang } = useLang();
  const text = COPY[lang];
  const normalized = useMemo(
    () => normalizeEarthquakes(earthquakes),
    [earthquakes],
  );
  const dateBounds = useMemo(() => getDatasetBounds(normalized), [normalized]);
  const [limitsByPolicy, setLimitsByPolicy] = useState(null);
  const [limitsLoading, setLimitsLoading] = useState(true);
  const [limitsError, setLimitsError] = useState(null);
  const [limitsRetry, setLimitsRetry] = useState(0);
  const [filters, setFilters] = useState(() => makeDefaultFilters(null));
  const [filtersInitialized, setFiltersInitialized] = useState(false);
  const [errors, setErrors] = useState({});
  const [showAbout, setShowAbout] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLimitsLoading(true);
    setLimitsError(null);
    setLimitsByPolicy(null);
    setFiltersInitialized(false);
    Promise.all([
      fetchInsightsLimits("reference_only", controller.signal),
      fetchInsightsLimits("include_unverified", controller.signal),
    ])
      .then(([referenceOnly, includeUnverified]) => {
        if (cancelled) return;
        setLimitsByPolicy({
          [DEPTH_POLICIES.MATCHED_ONLY]: normalizeLimitsResponse(
            referenceOnly,
            DEPTH_POLICIES.MATCHED_ONLY,
          ),
          [DEPTH_POLICIES.INCLUDE_UNVERIFIED]: normalizeLimitsResponse(
            includeUnverified,
            DEPTH_POLICIES.INCLUDE_UNVERIFIED,
          ),
        });
        setLimitsError(null);
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("Failed to load insight limits", {
            message: error?.message,
            status: error?.response?.status ?? error?.status,
            contentType:
              error?.response?.headers?.["content-type"] ?? error?.contentType,
            body: error?.response?.data ?? error?.body,
          });
          setLimitsByPolicy(null);
          setLimitsError(error);
        }
      })
      .finally(() => {
        if (!cancelled) setLimitsLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [limitsRetry]);
  const earthquakeDataReady = !loading && earthquakes.length > 0;
  const limitsReady = !limitsLoading && Boolean(limitsByPolicy);
  const boundsForPolicy = useCallback((policy) => {
    const metadata = limitsByPolicy?.[policy];
    const magnitude = metadata?.magnitude_limits;
    const depth = metadata?.depth_limits;
    if (
      !dateBounds ||
      !Number.isFinite(magnitude?.minimum) ||
      !Number.isFinite(magnitude?.maximum)
    )
      return null;
    const hasDepthLimits = Number.isFinite(depth?.minimum) &&
      Number.isFinite(depth?.maximum);
    return {
      startDate: dateBounds.startDate,
      endDate: dateBounds.endDate,
      minMagnitude: magnitude.minimum,
      maxMagnitude: magnitude.maximum,
      minDepth: hasDepthLimits ? depth.minimum : null,
      maxDepth: hasDepthLimits ? depth.maximum : null,
    };
  }, [dateBounds, limitsByPolicy]);
  const bounds = useMemo(
    () => boundsForPolicy(filters.depthQuality),
    [boundsForPolicy, filters.depthQuality],
  );
  const defaultBounds = useMemo(
    () => boundsForPolicy(DEPTH_POLICIES.MATCHED_ONLY),
    [boundsForPolicy],
  );
  const defaults = useMemo(
    () => makeDefaultFilters(defaultBounds),
    [defaultBounds],
  );
  useEffect(() => {
    if (!earthquakeDataReady || !limitsReady || !defaultBounds || filtersInitialized)
      return;
    setFilters(defaults);
    setFiltersInitialized(true);
  }, [defaultBounds, defaults, earthquakeDataReady, filtersInitialized, limitsReady]);
  const isInitialized = earthquakeDataReady && limitsReady && filtersInitialized;
  const filtered = useMemo(
    () => (isInitialized && bounds ? filterEarthquakes(normalized, filters) : []),
    [bounds, filters, isInitialized, normalized],
  );
  const depthRecords = useMemo(
    () => selectDepthRecords(filtered, filters),
    [filtered, filters],
  );
  const analysis = useMemo(
    () => buildAnalysis(filtered, depthRecords, filters.grouping),
    [depthRecords, filtered, filters.grouping],
  );
  const apply = (draft) => {
    const policyBounds = boundsForPolicy(draft.depthQuality);
    const next = clampFiltersToBounds({
      ...draft,
      minMagnitude: Number(draft.minMagnitude),
      maxMagnitude: Number(draft.maxMagnitude),
      minDepth: draft.minDepth === "" ? "" : Number(draft.minDepth),
      maxDepth: draft.maxDepth === "" ? "" : Number(draft.maxDepth),
    }, policyBounds);
    const nextErrors = validateFilters(next, policyBounds);
    setErrors(nextErrors);
    if (!Object.keys(nextErrors).length) setFilters(next);
  };
  const reset = () => {
    setErrors({});
    setFilters(defaults);
    return defaults;
  };
  const summary = text.showing
    .replace("{count}", analysis.count.toLocaleString())
    .replace("{start}", filters.startDate)
    .replace("{end}", filters.endDate)
    .replace("{minMag}", filters.minMagnitude)
    .replace("{maxMag}", filters.maxMagnitude)
    .replace("{minDepth}", filters.minDepth)
    .replace("{maxDepth}", filters.maxDepth);
  const depthSummary = (
    filters.depthQuality === "include_unverified"
      ? text.depthIncludedSummary
      : text.depthReferenceSummary
  )
    .replace("{reference}", analysis.depthQuality.reference.toLocaleString())
    .replace(
      "{included}",
      analysis.depthQuality.unverifiedIncluded.toLocaleString(),
    )
    .replace(
      "{excluded}",
      analysis.depthQuality.unverifiedAvailable.toLocaleString(),
    );
  const exportContext = {
    filters,
    depthMode:
      filters.depthQuality === "include_unverified"
        ? text.includeUnverified
        : text.referenceOnly,
    depthSummary,
  };
  return (
    <div className="analysis-page">
      <header className="analysis-header">
        <h1 className="analysis-brand" aria-label="MPGV Map Earthquake Insights">
          <span className="app-title__main">
            <svg
              className="app-title__iceland"
              viewBox="0 0 112 92"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M89.2 17.2 L92.1 16.5 L95.7 13.7 L98.2 13.7 L95.2 15.9 L93.2 19.5 L94.3 21 L95.4 21.5 L96.4 21 L97.2 21.9 L97.3 24.7 L96 27.7 L100.2 27.2 L100.9 29.6 L99.4 32.1 L102.3 30.5 L104.5 31.1 L105.9 33 L107 32.7 L107.5 33.3 L107.1 36.1 L105.8 37.1 L107.3 38.9 L106.2 40.8 L107.9 41.9 L108 43.6 L107.2 44.8 L105.3 45.4 L105.3 48.3 L103.5 51.1 L102.6 51.7 L100.2 51 L100.3 52.6 L99.5 53.5 L99.8 55.7 L97.9 58.5 L94.2 61.3 L91.9 61.2 L86.4 64 L78.7 71.1 L67.5 74.6 L66.3 78.6 L65 79.5 L63.3 78.8 L63.6 80.1 L59.5 81.6 L53.8 80.8 L48.8 78.6 L44.8 78.2 L42 75.2 L42.2 73.8 L43.2 73.4 L42.7 72.5 L40.5 74 L39.7 72.7 L38.3 72.5 L35.8 70.6 L36.1 69.4 L34.8 69.5 L32.9 71.3 L21.4 72 L20.5 67.6 L20.9 66.1 L22.7 68.2 L25.8 67.1 L28.9 63.9 L30.8 60.1 L32.7 59.4 L31 58.9 L27.1 60.9 L28.5 59.1 L27.6 58.6 L28.1 56.3 L31.5 53.7 L30.7 53.2 L26.6 55.9 L24.5 53.8 L25.2 51.4 L23.2 49.9 L14.8 49.2 L10.3 51.2 L8.3 48.3 L9.3 47.1 L14.7 46.3 L16.2 45.1 L17 46 L20.1 44.1 L21.9 44.6 L28.6 44.1 L29.7 40.9 L27.2 42.3 L22.8 40.7 L29.1 35 L27.6 33.9 L24.6 34.2 L23.9 33 L21.5 32.2 L19.9 32.7 L19 31.9 L9.5 35.9 L4 33.2 L6.2 31.2 L9.9 32.9 L8.4 31.1 L7.7 27.5 L9.4 27.7 L12.2 29.7 L15.4 28.1 L11.4 27.4 L10.1 25.8 L11 25 L13.1 25.1 L10.7 22 L11 20.8 L13.9 21.8 L12.4 19.9 L13.8 18.2 L17.5 20.4 L17.9 22.8 L19.8 22.7 L20.7 21.5 L21.3 21.8 L21.7 25.4 L23.4 24.5 L23.4 20.8 L18.6 17.5 L19.4 16.6 L23 16.3 L21.1 14.7 L17 14.6 L18.6 12.6 L23.5 12.5 L33.3 21.8 L32.2 23.1 L34.2 24.8 L33.6 28.3 L32.8 29.3 L30.9 28.7 L32.7 30.7 L32.8 31.8 L33.7 32 L33 34.4 L35 35.6 L35.9 39.1 L37.7 32.3 L39 30.7 L40.2 30.1 L41.5 32 L42.3 32.2 L43.3 28.8 L43.3 21.6 L44.7 20.1 L46.4 21.2 L50 26.9 L51.5 27.7 L52.6 20.6 L57.7 18.2 L63.1 25 L64.4 28.4 L64.8 26.2 L62.7 20.2 L62.9 18.8 L66.6 19.1 L70 23.2 L73.8 17.7 L76.8 19.5 L80.2 17.9 L80.7 16 L79.7 12.2 L82.4 10.4 L85 10.6 L87.6 14.2 L87.7 15.8 L89.2 17.2Z" />
            </svg>
            <span className="app-title__mpgv">
              <span className="app-title__m">M</span>
              <span className="app-title__pgv">PGV</span>
            </span>
          </span>
          <span className="app-title__map">-MAP — INSIGHTS</span>
        </h1>
        <div className="analysis-header-actions">
          <button
            className="left-panel__map-action-btn analysis-home-button"
            type="button"
            onClick={onMap}
            title={text.map}
            aria-label={text.map}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="m3 11 9-8 9 8" />
              <path d="M5 10v10h14V10" />
            </svg>
          </button>
          <button
            className="left-panel__map-action-btn left-panel__map-action-btn--language"
            type="button"
            onClick={toggleLang}
            title={text.language}
            aria-label={text.language}
          >
            {lang === "en" ? "IS" : "EN"}
          </button>
          <button
            className="left-panel__map-action-btn about-action"
            type="button"
            onClick={() => setShowAbout(true)}
            title={text.about}
            aria-label={text.about}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 5.5C4 4.7 4.7 4 5.5 4H10c1.1 0 2 .9 2 2v14c0-1.1-.9-2-2-2H5.5C4.7 18 4 17.3 4 16.5v-11Z" />
              <path d="M20 5.5C20 4.7 19.3 4 18.5 4H14c-1.1 0-2 .9-2 2v14c0-1.1.9-2 2-2h4.5c.8 0 1.5-.7 1.5-1.5v-11Z" />
              <path d="M12 6v14" />
            </svg>
          </button>
        </div>
      </header>
      <main id="analysis-content">
        <div className="analysis-title">
          <div>
            <h1>{text.analysis}</h1>
          </div>
          <div className="export-menu">
            <span>{text.exportAnalysis}</span>
            <button
              type="button"
              disabled={!filtered.length}
              onClick={() => exportEarthquakesCsv(filtered, exportContext)}
            >
              {text.downloadCsv}
            </button>
            <button
              type="button"
              disabled={!filtered.length}
              onClick={() => window.print()}
            >
              {text.printPdf}
            </button>
          </div>
        </div>
        {loadError && !earthquakes.length && !loading ? (
          <div className="analysis-state error" role="alert">
            <p>{text.loadError}</p>
            <button type="button" onClick={onRetryData}>{text.retryLimits}</button>
          </div>
        ) : limitsError ? (
          <div className="analysis-state error" role="alert">
            <p>
              {text.limitsLoadError}
              {import.meta.env.DEV && limitsError?.message
                ? ` ${limitsError.message}`
                : ""}
            </p>
            <button type="button" onClick={() => setLimitsRetry((value) => value + 1)}>
              {text.retryLimits}
            </button>
          </div>
        ) : !isInitialized ? (
          <AnalysisSkeleton text={text} />
        ) : (
          <>
            <AnalysisFilters
              filters={filters}
              bounds={bounds}
              errors={errors}
              onApply={apply}
              onReset={reset}
              limitsByPolicy={limitsByPolicy}
              limitsLoading={limitsLoading}
              text={text}
            />
            <p className="result-summary">{summary}</p>
            <p className="depth-quality-summary">{depthSummary}</p>
            {filters.depthQuality === "include_unverified" && (
              <p className="depth-quality-warning" role="note">
                {text.unverifiedWarning}
              </p>
            )}
            <SummaryCards analysis={analysis} text={text} />
            {filtered.length ? (
              <>
                <AnalysisCharts
                  analysis={analysis}
                  depthRecords={depthRecords}
                  includeUnverified={
                    filters.depthQuality === "include_unverified"
                  }
                  text={text}
                />
                <ResultsTables
                  analysis={analysis}
                  text={text}
                  onViewMap={onViewMap}
                />
              </>
            ) : (
              <div className="analysis-state">{text.noResults}</div>
            )}
          </>
        )}
        <footer className="analysis-footer">
          <h2>{text.analysisNotes}</h2>
          <p>{text.analysisNotesText}</p>
          <p className="analysis-footer-sources">
            <strong>{text.dataSources}</strong> MPGV <span aria-hidden="true">•</span> IMO <span aria-hidden="true">•</span> EPOS
            <span className="analysis-footer-divider" aria-hidden="true">|</span>
            <strong>{text.universityOfIceland}</strong>
          </p>
        </footer>
      </main>
      {showAbout && <About onClose={() => setShowAbout(false)} />}
    </div>
  );
}
