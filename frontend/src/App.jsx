import { useState, useEffect, useCallback, useMemo } from "react";
import MapComponent from "./components/MapComponent";
import LeftPanel from "./components/LeftPanel";
import RightPanel from "./components/RightPanel";
import About from "./components/About";
import { fetchEarthquakeData, fetchVolcanoData } from "./api";
import { parseBackendUtcDate } from "./utils/datetime";
import { useT } from "./i18n";
import "./App.css";

const App = () => {
    const t = useT();
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    const currentDay = new Date().getDate();

    const [filteredData, setFilteredData] = useState([]);
    const [allData, setAllData] = useState([]);
    const [volcanoData, setVolcanoData] = useState([]);
    const [maxMagnitude, setMaxMagnitude] = useState(3.0);
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [showVolcanoes, setShowVolcanoes] = useState(false);
    const [magnitudeFilter, setMagnitudeFilter] = useState(3.0);
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
            <div className={`map-container${rightPanelOpen ? " right-panel-open" : ""}`}>
                <div className="about-button-container">
                    <button className="nav-button" onClick={() => setShowAbout(true)}>
                        {t('about')}
                    </button>
                </div>

                <div className="controls">
                    <h1 style={{
                        color: isDarkMode ? "#fff" : "#000",
                        textShadow: isDarkMode ? "2px 2px 4px rgba(0,0,0,0.5)" : "none"
                    }}>
                        {t('app_title')}
                    </h1>
                </div>

                <LeftPanel
                    onMapTypeChange={handleMapTypeChange}
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
                    minMagnitude={3.0}
                    maxMagnitude={maxMagnitude}
                    onMagnitudeFilterChange={handleMagnitudeFilterChange}
                    onResetView={resetView}
                    onShowAbout={() => setShowAbout(true)}
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
