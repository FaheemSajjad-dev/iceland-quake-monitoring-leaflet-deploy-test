import { useState, useEffect, useCallback, useMemo } from "react";
import MapComponent from "./components/MapComponent";
import TimeWindowSlider from "./components/TimeWindowSlider";
import MagnitudeScale from "./components/MagnitudeScale";
import About from "./components/About";
import { fetchEarthquakeData, fetchVolcanoData } from "./api";
import { parseBackendUtcDate } from "./utils/datetime";
import "./App.css";

const App = () => {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    const currentDay = new Date().getDate();

    const [filteredData, setFilteredData] = useState([]);
    const [allData, setAllData] = useState([]);
    const [volcanoData, setVolcanoData] = useState([]);
    const [maxMagnitude, setMaxMagnitude] = useState(3.0);
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [showVolcanoes, setShowVolcanoes] = useState(false);
    const [magnitudeFilter, setMagnitudeFilter] = useState(2.7);
    const [colorOwner, setColorOwner] = useState('timeline');

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

    const loadData = useCallback(async () => {
        try {
            const data = await fetchEarthquakeData();
            console.log("Loaded earthquake data:", data.length);
            setAllData(data);

            const volcanoes = await fetchVolcanoData();
            console.log("Loaded volcano data:", volcanoes.length);
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

    // Max magnitude — only depends on allData, not on filter state
    useEffect(() => {
        if (allData.length === 0) return;
        const mags = allData.map(q => parseFloat(q.Mw_mean)).filter(n => !isNaN(n));
        setMaxMagnitude(mags.length ? mags.reduce((a, b) => a > b ? a : b, 2.7) : 5.8);
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
        setIsDarkMode(type === "dark_mode" || type === "heatmap");
        setIsHeatmap(type === "heatmap");
        if (type === "heatmap") setColorOwner('timeline');
    }, []);
    const toggleVolcanoes = useCallback(() => {
        setShowVolcanoes(v => {
            const next = !v;
            if (next) {
                fetchVolcanoData().then(setVolcanoData).catch(() => {});
            }
            return next;
        });
    }, []);
    const handleMagnitudeFilterChange = useCallback(v => setMagnitudeFilter(v), []);
    // Stable empty array so MapComponent doesn't re-render when volcanoes are hidden
    const emptyVolcanoes = useMemo(() => [], []);
    return (
        <div className="app-container">
            <div className="map-container">
                <div className="about-button-container">
                    <button
                        className="nav-button"
                        onClick={() => setShowAbout(true)}
                    >
                        About
                    </button>
                </div>

                <div className="controls">
                    <h1 style={{
                        color: isDarkMode ? "#fff" : "#000",
                        textShadow: isDarkMode ? "2px 2px 4px rgba(0,0,0,0.5)" : "none"
                    }}>
                        Iceland MPGV Earthquake Map
                    </h1>
                </div>

                <TimeWindowSlider onFilterChange={handleFilterChange} colorOwner={colorOwner} vertical isHeatmap={isHeatmap} />

                <MapComponent
                    earthquakes={filteredData}
                    volcanoes={showVolcanoes ? volcanoData : emptyVolcanoes}
                    maxMagnitude={maxMagnitude}
                    onMapTypeChange={handleMapTypeChange}
                    showVolcanoes={showVolcanoes}
                    toggleVolcanoes={toggleVolcanoes}
                    colorOwner={colorOwner}
                    onChangeColorOwner={setColorOwner}
                    isDarkMode={isDarkMode}   
                />

                <MagnitudeScale
                    minMagnitude={2.7}
                    maxMagnitude={maxMagnitude}
                    onMagnitudeFilterChange={handleMagnitudeFilterChange}
                    colorOwner={colorOwner}
                />
            </div>

            {showAbout && <About onClose={() => setShowAbout(false)} />}
        </div>
    );
};

export default App;
