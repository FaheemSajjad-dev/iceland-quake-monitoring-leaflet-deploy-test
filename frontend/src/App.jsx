import { useState, useEffect, useCallback, useMemo } from "react";
import MapComponent from "./components/MapComponent";
import LeftPanel from "./components/LeftPanel";
import MapTypeSelector from "./components/MapTypeSelector";
import RightPanel from "./components/RightPanel";
import About from "./components/About";
import { fetchEarthquakeData, fetchVolcanoData } from "./api";
import { parseBackendUtcDate } from "./utils/datetime";
import "./App.css";

const MIN_MAGNITUDE = 3.0;
const App = () => {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    const currentDay = new Date().getDate();

    const [filteredData, setFilteredData] = useState([]);
    const [allData, setAllData] = useState([]);
    const [volcanoData, setVolcanoData] = useState([]);
    const [maxMagnitude, setMaxMagnitude] = useState(MIN_MAGNITUDE);
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [showVolcanoes, setShowVolcanoes] = useState(false);
    const [magnitudeFilter, setMagnitudeFilter] = useState(MIN_MAGNITUDE);
    const [colorOwner, setColorOwner] = useState('timeline');
    const [mapType, setMapType] = useState('roadmap');
    const [showGrid, setShowGrid] = useState(false);
    const [showFaults, setShowFaults] = useState(false);

    const [dateRange, setDateRange] = useState({
        startYear: 2020,
        startMonth: 6,
        startDay: 1,
        endYear: currentYear,
        endMonth: currentMonth,
        endDay: currentDay,
        isDayPrecision: false
    });

    const [showAbout, setShowAbout] = useState(false);
    const [selectedVolcano, setSelectedVolcano] = useState(null);
    const openAbout = useCallback(() => {
        setSelectedVolcano(null);
        setShowAbout(true);
    }, []);
    const [resetViewTrigger, setResetViewTrigger] = useState(0);
    const resetView = useCallback(() => setResetViewTrigger(v => v + 1), []);
    const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(() =>
        typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches
    );
    const [isMobile, setIsMobile] = useState(() =>
        typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches
    );

    useEffect(() => {
        if (typeof window === "undefined") return undefined;
        const query = window.matchMedia("(max-width: 767px)");
        const update = () => setIsMobile(query.matches);
        update();
        query.addEventListener?.("change", update);
        return () => query.removeEventListener?.("change", update);
    }, []);

    useEffect(() => {
        if (!selectedVolcano) return;
        const t = setTimeout(() => setSelectedVolcano(null), 15_000);
        return () => clearTimeout(t);
    }, [selectedVolcano]);

    const loadData = useCallback(async () => {
        try {
            const data = await fetchEarthquakeData();
            setAllData(data);
            const volcanoes = await fetchVolcanoData();
            setVolcanoData(volcanoes);
        } catch (error) {
            console.error("Error loading data:", error);
        }
    }, []);

    useEffect(() => {
        loadData();
        const interval = setInterval(loadData, 3 * 60 * 1000);
        return () => clearInterval(interval);
    }, [loadData]);

    useEffect(() => {
        if (allData.length === 0) return;
        const mags = allData.map(q => parseFloat(q.Mw_mean)).filter(n => !isNaN(n));
        setMaxMagnitude(mags.length ? mags.reduce((a, b) => a > b ? a : b, 3.0) : 5.8);
    }, [allData]);

    useEffect(() => {
        if (allData.length === 0) return;
        const filtered = allData.filter(quake => {
            if (!quake["Date-time"] || !quake.Mw_mean) return false;
            try {
                const qd = parseBackendUtcDate(quake["Date-time"]);
                if (!qd) return false;
                const y = qd.getUTCFullYear(), m = qd.getUTCMonth()+1, d = qd.getUTCDate();
                let inRange;
                if (dateRange.isDayPrecision) {
                    const qv = y*10000 + m*100 + d;
                    const sv = dateRange.startYear*10000 + dateRange.startMonth*100 + dateRange.startDay;
                    const ev = dateRange.endYear*10000 + dateRange.endMonth*100 + dateRange.endDay;
                    inRange = qv >= sv && qv <= ev;
                } else {
                    const qv = y*100 + m;
                    const sv = dateRange.startYear*100 + dateRange.startMonth;
                    const ev = dateRange.endYear*100 + dateRange.endMonth;
                    inRange = qv >= sv && qv <= ev;
                }
                const mag = parseFloat(quake.Mw_mean);
                return inRange && !isNaN(mag) && mag >= magnitudeFilter;
            } catch {
                return false;
            }
        });
        setFilteredData(filtered);
    }, [allData, dateRange, magnitudeFilter]);

    const handleFilterChange = useCallback((sy, sm, ey, em, sd, ed) => {
        const hasDay = sd !== undefined && ed !== undefined;
        setDateRange({
            startYear: sy,
            startMonth: sm,
            startDay: sd || 1,
            endYear: ey || sy,
            endMonth: em || sm,
            endDay: ed || new Date(ey||sy, (em||sm), 0).getDate(),
            isDayPrecision: hasDay
        });
    }, []);

    const [isHeatmap, setIsHeatmap] = useState(false);

    const handleMapTypeChange = useCallback(type => {
        setMapType(type);
        setIsDarkMode(type === "dark_mode" || type === "heatmap" || type === "satellite");
        setIsHeatmap(type === "heatmap");
        if (type === "heatmap") {
            setColorOwner('timeline');
            setShowFaults(false);
        } else if (type === "satellite") {
            setColorOwner('timeline');
        }
    }, []);

    const toggleVolcanoes = useCallback(() => {
        setShowVolcanoes(v => {
            const next = !v;
            if (next) fetchVolcanoData().then(setVolcanoData).catch(() => {});
            return next;
        });
    }, []);


    const handleMagnitudeFilterChange = useCallback(v => setMagnitudeFilter(v), []);
    const emptyVolcanoes = useMemo(() => [], []);
    const rightPanelOpen = showVolcanoes && !isMobile;

    return (
        <div className="app-container">
            <div className={`map-container${rightPanelOpen ? " right-panel-open" : ""}${!isMobile && leftPanelCollapsed ? " title-left" : ""}${isMobile && !leftPanelCollapsed ? " mobile-left-panel-open" : ""}`}>
                <div className="map-type-control-container">
                    <MapTypeSelector onMapTypeChange={handleMapTypeChange} selectedType={mapType} />
                </div>

                <div className="controls">
                    <h1 style={{
                        color: isDarkMode ? "#fff" : "#000",
                        textShadow: isDarkMode ? "2px 2px 4px rgba(0,0,0,0.5)" : "none"
                    }}>
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
                                <span className="app-title__m">M</span><span className="app-title__pgv">PGV</span>
                            </span>
                        </span>
                        <span className="app-title__map">-MAP</span>
                    </h1>
                </div>

                <LeftPanel
                    mapType={mapType}
                    showVolcanoes={showVolcanoes}
                    toggleVolcanoes={toggleVolcanoes}
                    showGrid={showGrid}
                    onShowGridChange={() => setShowGrid(v => !v)}
                    showFaults={showFaults}
                    onShowFaultsChange={() => setShowFaults(v => !v)}
                    colorOwner={colorOwner}
                    onChangeColorOwner={setColorOwner}
                    isHeatmap={isHeatmap}
                    onFilterChange={handleFilterChange}
                    minMagnitude={MIN_MAGNITUDE}
                    maxMagnitude={maxMagnitude}
                    onMagnitudeFilterChange={handleMagnitudeFilterChange}
                    onResetView={resetView}
                    onShowAbout={openAbout}
                    collapsed={leftPanelCollapsed}
                    onCollapsedChange={setLeftPanelCollapsed}
                />

                {!isMobile && (
                    <RightPanel
                        volcanoes={volcanoData}
                        selectedVolcano={selectedVolcano}
                        onSelectVolcano={setSelectedVolcano}
                        showVolcanoes={showVolcanoes}
                        onToggleVolcanoes={toggleVolcanoes}
                    />
                )}

                <MapComponent
                    earthquakes={filteredData}
                    volcanoes={showVolcanoes ? volcanoData : emptyVolcanoes}
                    maxMagnitude={maxMagnitude}
                    mapType={mapType}
                    showGrid={showGrid}
                    showFaults={showFaults}
                    colorOwner={colorOwner}
                    isDarkMode={isDarkMode}
                    selectedVolcano={selectedVolcano}
                    onSelectVolcano={setSelectedVolcano}
                    aboutOpen={showAbout}
                    resetViewTrigger={resetViewTrigger}
                    rightPanelOpen={rightPanelOpen}
                    mobileLeftPanelOpen={isMobile && !leftPanelCollapsed}
                />

            </div>

            {showAbout && <About onClose={() => setShowAbout(false)} />}
        </div>
    );
};

export default App;
