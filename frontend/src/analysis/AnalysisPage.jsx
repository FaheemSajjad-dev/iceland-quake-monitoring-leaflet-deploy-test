import { useEffect, useMemo, useState } from "react";
import About from "../components/About";
import { useLang } from "../i18n";
import AnalysisFilters from "./AnalysisFilters";
import AnalysisCharts from "./AnalysisCharts";
import ResultsTables from "./ResultsTables";
import SummaryCards from "./SummaryCards";
import {
  buildAnalysis,
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
    analysis: "Data Analysis",
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
    referenceOnly: "Reference only",
    includeUnverified: "Include unverified MPGV depths",
    depthFilterHint:
      "Depth limits apply only to depths participating in depth analysis.",
    referenceDepth: "Reference depth",
    unverifiedDepth: "Unverified MPGV depth",
    unverifiedShort: "unverified",
    depthUnavailable: "Depth unavailable",
    depthSource: "Depth source",
    depthQualityLabel: "Depth quality",
    unverifiedWarning:
      "MPGV-only depth values may contain unreliable outliers. Raw values are unchanged.",
    depthReferenceSummary:
      "Depth analysis uses {reference} reference depth values. {excluded} MPGV-only depth values are excluded.",
    depthIncludedSummary:
      "Depth analysis uses {reference} reference and {included} unverified MPGV depth values.",
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
    invalidMagnitude: "Minimum magnitude cannot exceed maximum magnitude.",
    invalidDepth: "Minimum depth cannot exceed maximum depth.",
    outsideRange: "Dates must stay within the available catalogue range.",
    loading: "Loading earthquake analysis…",
    loadError: "Earthquake data could not be loaded. Try again shortly.",
    noResults: "No earthquakes match these filters.",
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
    results: "Results tables",
    strongestEarthquakes: "Strongest earthquakes",
    recentEarthquakes: "Recent earthquakes",
    date: "Date and time",
    coordinates: "Coordinates",
    source: "Source",
    viewMap: "View on map",
    sort: "Sort by ",
    previous: "Previous",
    next: "Next",
    exportAnalysis: "Export Analysis",
    downloadCsv: "Download filtered CSV",
    printPdf: "Save / print PDF",
    showing:
      "Showing {count} earthquakes from {start} to {end} with magnitude {minMag}–{maxMag}. Depth analysis range: {minDepth}–{maxDepth} km.",
    language: "Íslenska",
  },
  is: {
    depthQuality: "Gæði dýpis",
    referenceOnly: "Aðeins viðmiðunardýpi",
    includeUnverified: "Taka með óstaðfest MPGV-dýpi",
    depthFilterHint:
      "Dýptarmörk eiga aðeins við gögn sem taka þátt í dýptargreiningu.",
    referenceDepth: "Viðmiðunardýpi",
    unverifiedDepth: "Óstaðfest MPGV-dýpi",
    unverifiedShort: "óstaðfest",
    depthUnavailable: "Dýpi ekki tiltækt",
    depthSource: "Uppruni dýpis",
    depthQualityLabel: "Gæði dýpis",
    unverifiedWarning:
      "MPGV-dýpi geta innihaldið óáreiðanleg frávik. Hráum gildum er ekki breytt.",
    depthReferenceSummary:
      "Dýptargreining notar {reference} viðmiðunardýpi. {excluded} MPGV-dýpi eru undanskilin.",
    depthIncludedSummary:
      "Dýptargreining notar {reference} viðmiðunardýpi og {included} óstaðfest MPGV-dýpi.",
    analysis: "Gagnagreining",
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
    invalidMagnitude: "Lágmarksstærð má ekki vera hærri en hámarksstærð.",
    invalidDepth: "Minnsta dýpi má ekki vera meira en mesta dýpi.",
    outsideRange: "Dagsetningar þurfa að vera innan gagnatímabilsins.",
    loading: "Hleð greiningu…",
    loadError: "Ekki tókst að hlaða jarðskjálftagögnum.",
    noResults: "Engir jarðskjálftar passa við síurnar.",
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
    results: "Niðurstöður",
    strongestEarthquakes: "Stærstu jarðskjálftar",
    recentEarthquakes: "Nýlegir jarðskjálftar",
    date: "Dagsetning og tími",
    coordinates: "Hnit",
    source: "Uppruni",
    viewMap: "Skoða á korti",
    sort: "Raða eftir ",
    previous: "Fyrri",
    next: "Næsta",
    exportAnalysis: "Flytja út greiningu",
    downloadCsv: "Sækja síað CSV",
    printPdf: "Vista / prenta PDF",
    showing:
      "Sýni {count} jarðskjálfta frá {start} til {end}, stærð {minMag}–{maxMag}. Dýptargreining: {minDepth}–{maxDepth} km.",
    language: "English",
  },
};

export default function AnalysisPage({
  earthquakes,
  loading,
  loadError,
  onMap,
  onViewMap,
}) {
  const { lang, toggleLang } = useLang();
  const text = COPY[lang];
  const normalized = useMemo(
    () => normalizeEarthquakes(earthquakes),
    [earthquakes],
  );
  const bounds = useMemo(() => getDatasetBounds(normalized), [normalized]);
  const defaults = useMemo(() => makeDefaultFilters(bounds), [bounds]);
  const [filters, setFilters] = useState(defaults);
  const [errors, setErrors] = useState({});
  const [showAbout, setShowAbout] = useState(false);
  useEffect(() => {
    if (bounds)
      setFilters((current) => (current.startDate ? current : defaults));
  }, [bounds, defaults]);
  const filtered = useMemo(
    () => (bounds ? filterEarthquakes(normalized, filters) : []),
    [bounds, filters, normalized],
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
    const next = {
      ...draft,
      minMagnitude: Number(draft.minMagnitude),
      maxMagnitude: Number(draft.maxMagnitude),
      minDepth: Number(draft.minDepth),
      maxDepth: Number(draft.maxDepth),
    };
    const nextErrors = validateFilters(next, bounds);
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
        <h1 className="analysis-brand" aria-label="MPGV Map Analysis">
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
          <span className="app-title__map">-MAP — ANALYSIS</span>
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
            <p>MPGV Monitor</p>
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
        {loading && !earthquakes.length ? (
          <div className="analysis-state" role="status">
            {text.loading}
          </div>
        ) : loadError && !earthquakes.length ? (
          <div className="analysis-state error" role="alert">
            {text.loadError}
          </div>
        ) : (
          <>
            <AnalysisFilters
              filters={filters}
              bounds={bounds}
              errors={errors}
              onApply={apply}
              onReset={reset}
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
                  exportContext={exportContext}
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
      </main>
      {showAbout && <About onClose={() => setShowAbout(false)} />}
    </div>
  );
}
