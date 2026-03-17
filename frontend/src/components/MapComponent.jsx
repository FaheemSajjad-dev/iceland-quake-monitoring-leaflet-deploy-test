import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { MapContainer, TileLayer, Pane, ScaleControl, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import MapTypeSelector from "./MapTypeSelector";
import VolcanoMarker from "./VolcanoMarker";
import "./MapComponent.css";
import { fetchShakeMapValidated } from "../api";
import { parseBackendUtcDate } from "../utils/datetime";

const CENTER = [64.9631, -19.0208];

const MIN_MAG = 2.7;
const MAG_PALETTE_STOPS = ["#FDE725", "#5DC863", "#21918C", "#3B528B", "#440154"];

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function lerpHex(hex0, hex1, t) {
  const C0 = hexToRgb(hex0);
  const C1 = hexToRgb(hex1);
  return `rgb(${Math.round(C0.r + (C1.r - C0.r) * t)}, ${Math.round(C0.g + (C1.g - C0.g) * t)}, ${Math.round(C0.b + (C1.b - C0.b) * t)})`;
}
function samplePalette(stops, t) {
  if (!stops?.length) return "#888";
  if (stops.length === 1) return stops[0];
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.floor(x);
  return lerpHex(stops[i], stops[Math.min(i + 1, stops.length - 1)], x - i);
}
const getMarkerColor = (magnitude, maxMagnitude) => {
  const t = (parseFloat(magnitude) - MIN_MAG) / ((parseFloat(maxMagnitude) - MIN_MAG) || 1);
  return samplePalette(MAG_PALETTE_STOPS, t);
};
const getMarkerPixelSize = (mag, maxMag) => {
  const denom = (parseFloat(maxMag) - MIN_MAG) || 1;
  const t = Math.max(0, Math.min(1, (parseFloat(mag) - MIN_MAG) / denom));
  return Math.round(8 + Math.pow(t, 0.7) * 6);
};

const TWILIGHT_MONTH_COLORS = [
  "#e2d9ff", "#cbb9f6", "#a991e0", "#8667c2",
  "#6a51a3", "#4b2f86", "#2d1a6f", "#234078",
  "#30707b", "#4b9276", "#7bab6d", "#b7cf77",
];
const getTwilightColorForDate = (isoString) => {
  if (!isoString) return "#6a51a3";
  const d = parseBackendUtcDate(isoString);
  if (!d) return "#6a51a3";
  return TWILIGHT_MONTH_COLORS[d.getUTCMonth()] || "#6a51a3";
};

const TILE_LAYERS = {
  roadmap: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
    maxNativeZoom: 19,
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri",
    maxZoom: 19,
    maxNativeZoom: 17, // Esri World Imagery native cap; above 17 Leaflet up-scales existing tiles instead of requesting blank ones
  },
  dark_mode: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
    maxZoom: 19,
    maxNativeZoom: 19,
  },
};

// Shared tile options applied to every TileLayer — key for zoom smoothness
const TILE_PROPS = {
  updateWhenZooming: false, // do not fetch new tiles during CSS zoom animation; scaled copies of existing tiles are shown instead — eliminates blank tile flicker
  updateWhenIdle:    false, // fetch new tiles immediately after zoom/pan settles, not deferred (better on desktop)
  keepBuffer:        4,     // pre-load 4 extra tile rows in every direction — greatly reduces blank edges when panning or zooming
  detectRetina:      false, // do not request 2× tiles (e.g. @2x via {r}); avoids over-requesting and potential blank tiles on retina screens where provider has no hi-res variant
};

const TileLayerManager = ({ mapType }) => {
  if (mapType === "heatmap") {
    // Base terrain (no labels) → heatmap renders above this → labels on top
    return (
      <>
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          maxZoom={19}
          maxNativeZoom={19}
          zIndex={1}
          {...TILE_PROPS}
        />
        <Pane name="heatmap-labels" style={{ zIndex: 650 }}>
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}.png"
            attribution=""
            maxZoom={19}
            maxNativeZoom={19}
            {...TILE_PROPS}
          />
        </Pane>
      </>
    );
  }
  const layer = TILE_LAYERS[mapType] || TILE_LAYERS.roadmap;
  return (
    <TileLayer
      key={mapType}
      url={layer.url}
      attribution={layer.attribution}
      maxZoom={layer.maxZoom}
      maxNativeZoom={layer.maxNativeZoom}
      {...TILE_PROPS}
    />
  );
};

const MinZoomController = ({ mapType }) => {
  const map = useMap();
  useEffect(() => {
    map.setMinZoom(5.5);
  }, [map, mapType]);
  return null;
};

// Ensures the map measures its container correctly if CSS finishes after initial render.
const MapReadyHandler = () => {
  const map = useMap();
  useEffect(() => {
    const id = setTimeout(() => map.invalidateSize(), 150);
    return () => clearTimeout(id);
  }, [map]);
  return null;
};

const MapClickHandler = ({ onClick }) => {
  useMapEvents({ click: onClick });
  return null;
};

const MapPanes = () => {
  const map = useMap();

  useEffect(() => {
    const ensurePane = (name, zIndex, pointerEvents = "auto") => {
      const existing = map.getPane(name) || map.createPane(name);
      existing.style.zIndex = String(zIndex);
      existing.style.pointerEvents = pointerEvents;
    };

    ensurePane("grid-pane", 350, "none");
    ensurePane("earthquake-pane", 400, "auto");
    ensurePane("volcano-pane", 450, "auto");
  }, [map]);

  return null;
};

const GridOverlay = ({ show, isDarkMode, mapType }) => {
  const map = useMap();
  const gridRef = useRef([]);
  const darkLike = isDarkMode || mapType === "satellite" || mapType === "dark_mode" || mapType === "heatmap";

  const createGrid = useCallback(() => {
    gridRef.current.forEach((o) => map.removeLayer(o));
    gridRef.current = [];
    if (!show) return;

    const bounds = map.getBounds();
    const zoom = map.getZoom();
    const north = bounds.getNorth();
    const south = bounds.getSouth();
    const east = bounds.getEast();
    const west = bounds.getWest();

    let gridSpacing, subGridSpacing = null, decimals = 0;
    if (zoom < 5)       { gridSpacing = 5;    decimals = 0; }
    else if (zoom < 7)  { gridSpacing = 2;    decimals = 0; }
    else if (zoom < 8)  { gridSpacing = 1;    subGridSpacing = 0.5;   decimals = 1; }
    else if (zoom < 9)  { gridSpacing = 0.5;  subGridSpacing = 0.1;   decimals = 1; }
    else if (zoom < 11) { gridSpacing = 0.2;  subGridSpacing = 0.05;  decimals = 2; }
    else if (zoom < 13) { gridSpacing = 0.1;  subGridSpacing = 0.02;  decimals = 2; }
    else if (zoom < 15) { gridSpacing = 0.05; subGridSpacing = 0.01;  decimals = 3; }
    else                { gridSpacing = 0.01; subGridSpacing = 0.002; decimals = 4; }

    const mainColor  = darkLike ? "#ddd8cc" : "#666666";
    const subColor   = darkLike ? "#bbb5aa" : "#888888";
    const lblColor   = darkLike ? "#ffffff" : "#333333";
    const subLblColor = darkLike ? "#e6e6e6" : "#666666";

    const latExt = (north - south) * 0.1;
    const lngExt = (east - west) * 0.1;
    const extN = Math.min(85, north + latExt);
    const extS = Math.max(-85, south - latExt);
    const extE = east + lngExt;
    const extW = west - lngExt;

    const addLine = (coords, color, weight, opacity) => {
      gridRef.current.push(
        L.polyline(coords, { color, weight, opacity, interactive: false, pane: "grid-pane" }).addTo(map)
      );
    };
    const addLabel = (lat, lng, text, color, size, fontWeight = "bold") => {
      gridRef.current.push(
        L.marker([lat, lng], {
          icon: L.divIcon({
            className: "",
            html: `<span style="color:${color};font-size:${size};font-weight:${fontWeight};white-space:nowrap;pointer-events:none;">${text}</span>`,
            iconSize: [80, 16],
            iconAnchor: [0, 8],
          }),
          interactive: false,
          zIndexOffset: -9000,
          pane: "grid-pane",
        }).addTo(map)
      );
    };

    const startLat = Math.floor(extS / gridSpacing) * gridSpacing;
    const endLat   = Math.ceil(extN / gridSpacing) * gridSpacing;
    const startLng = Math.floor(extW / gridSpacing) * gridSpacing;
    const endLng   = Math.ceil(extE / gridSpacing) * gridSpacing;

    // Safe left margin: 120px clears the map-type button and the vertical time-window slider.
    // Convert that pixel column back to a geographic longitude so lat labels never
    // land underneath the left-side UI panel regardless of zoom or pan position.
    const SAFE_LEFT_PX = 120;
    const mapHeight = map.getSize().y;
    const safeLatLabelLng = map.containerPointToLatLng([SAFE_LEFT_PX, mapHeight / 2]).lng;
    const latLabelLng = (lng) => Math.max(lng, safeLatLabelLng);

    for (let lat = startLat; lat <= endLat; lat += gridSpacing) {
      if (lat < -85 || lat > 85) continue;
      addLine([[lat, extW], [lat, extE]], mainColor, 1, 0.8);
      addLabel(lat, latLabelLng(west + (east - west) * 0.02),
        `${lat.toFixed(decimals)}°${lat > 0 ? "N" : lat < 0 ? "S" : ""}`,
        lblColor, "10px");
    }
    for (let lng = startLng; lng <= endLng; lng += gridSpacing) {
      addLine([[extS, lng], [extN, lng]], mainColor, 1, 0.8);
      addLabel(south + (north - south) * 0.05, lng,
        `${lng.toFixed(decimals)}°${lng > 0 ? "E" : lng < 0 ? "W" : ""}`,
        lblColor, "10px");
    }

    if (subGridSpacing !== null) {
      const sLat = Math.floor(extS / subGridSpacing) * subGridSpacing;
      const eLat = Math.ceil(extN / subGridSpacing) * subGridSpacing;
      const sLng = Math.floor(extW / subGridSpacing) * subGridSpacing;
      const eLng = Math.ceil(extE / subGridSpacing) * subGridSpacing;

      for (let lat = sLat; lat <= eLat; lat += subGridSpacing) {
        if (lat < -85 || lat > 85) continue;
        if (Math.abs(lat % gridSpacing) < subGridSpacing * 0.1) continue;
        addLine([[lat, extW], [lat, extE]], subColor, 0.5, 0.5);
        if (zoom > 12 && lat % (subGridSpacing * 5) < subGridSpacing * 0.1) {
          addLabel(lat, latLabelLng(west + (east - west) * 0.02),
            `${lat.toFixed(decimals)}°${lat > 0 ? "N" : lat < 0 ? "S" : ""}`,
            subLblColor, "9px", "400");
        }
      }
      for (let lng = sLng; lng <= eLng; lng += subGridSpacing) {
        if (Math.abs(lng % gridSpacing) < subGridSpacing * 0.1) continue;
        addLine([[extS, lng], [extN, lng]], subColor, 0.5, 0.5);
        if (zoom > 12 && lng % (subGridSpacing * 5) < subGridSpacing * 0.1) {
          addLabel(south + (north - south) * 0.05, lng,
            `${lng.toFixed(decimals)}°${lng > 0 ? "E" : lng < 0 ? "W" : ""}`,
            subLblColor, "9px", "400");
        }
      }
    }
  }, [map, show, darkLike]);

  useEffect(() => {
    createGrid();
    map.on("zoomend moveend", createGrid);
    return () => {
      map.off("zoomend moveend", createGrid);
      gridRef.current.forEach((o) => map.removeLayer(o));
      gridRef.current = [];
    };
  }, [map, createGrid]);

  return null;
};

const quakeKey = (q) => `${q["Date-time"]}_${q.Latitude}_${q.Longitude}`;

const getQuakeMarkerStyle = (px, color, isSelected) => ({
  radius: Math.max(4, (isSelected ? px + 4 : px) / 2),
  fillColor: color,
  fillOpacity: 1,
  stroke: isSelected,
  color: "#ffffff",
  weight: isSelected ? 2 : 0,
  opacity: 1,
});

const EarthquakeMarkers = ({ earthquakes, markerIcons, selectedEarthquake, onMarkerClick, visible }) => {
  const map = useMap();
  const layerGroupRef = useRef(null);
  const rendererRef = useRef(null);
  const markersMapRef = useRef(new Map());
  const prevSelectedRef = useRef(null);
  const selectedEqRef = useRef(selectedEarthquake);
  const markerIconsRef = useRef(markerIcons);
  selectedEqRef.current = selectedEarthquake;
  markerIconsRef.current = markerIcons;

  useEffect(() => {
    rendererRef.current = L.canvas({ pane: "earthquake-pane" });
    const lg = L.layerGroup().addTo(map);
    layerGroupRef.current = lg;
    return () => {
      map.removeLayer(lg);
      layerGroupRef.current = null;
      rendererRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    const lg = layerGroupRef.current;
    if (!lg) return;
    if (visible) { if (!map.hasLayer(lg)) lg.addTo(map); }
    else { map.removeLayer(lg); }
  }, [map, visible]);

  useEffect(() => {
    const lg = layerGroupRef.current;
    if (!lg) return;
    lg.clearLayers();
    markersMapRef.current = new Map();

    const sel = selectedEqRef.current;
    earthquakes.forEach((quake, index) => {
      const lat = parseFloat(quake.Latitude);
      const lng = parseFloat(quake.Longitude);
      if (isNaN(lat) || isNaN(lng)) return;

      const isSelected =
        sel &&
        quake["Date-time"] === sel["Date-time"] &&
        quake.Latitude === sel.Latitude &&
        quake.Longitude === sel.Longitude;

      const { px, color } = markerIcons[index] || {};
      const marker = L.circleMarker([lat, lng], {
        ...getQuakeMarkerStyle(px, color, isSelected),
        renderer: rendererRef.current,
      })
        .on("click", (e) => { L.DomEvent.stopPropagation(e); onMarkerClick(quake); })
        .addTo(lg);
      if (isSelected) marker.bringToFront();

      markersMapRef.current.set(quakeKey(quake), { marker, quake, index });
    });
  }, [map, earthquakes, markerIcons, onMarkerClick]);

  useEffect(() => {
    const prev = prevSelectedRef.current;
    prevSelectedRef.current = selectedEarthquake;

    const updateMarker = (quake, isSelected) => {
      if (!quake) return;
      const entry = markersMapRef.current.get(quakeKey(quake));
      if (!entry) return;
      const { px, color } = markerIconsRef.current[entry.index] || {};
      entry.marker.setStyle(getQuakeMarkerStyle(px, color, isSelected));
      entry.marker.setRadius(Math.max(4, (isSelected ? px + 4 : px) / 2));
      if (isSelected) entry.marker.bringToFront();
      else entry.marker.bringToBack();
    };

    updateMarker(prev, false);
    updateMarker(selectedEarthquake, true);
  }, [selectedEarthquake]);

  return null;
};

// Color ramp: transparent → dark blue → blue → teal → amber → orange → deep red
// Equal-weight stops eliminate the wide yellow band; reads cleanly on a dark basemap.
const HEAT_GRADIENT = {
  0.00: 'rgba(0,0,0,0)',
  0.15: '#253494',   // dark indigo-blue (sparse — first visible)
  0.30: '#2c7fb8',   // medium blue
  0.50: '#41b6c4',   // teal
  0.65: '#fdae61',   // amber
  0.80: '#f46d43',   // orange
  1.00: '#d73027',   // deep red (peak density)
};

const heatRadius = (z) => {
  if (z <= 5)  return 15;
  if (z <= 6)  return 22;
  if (z <= 7)  return 30;
  if (z <= 8)  return 38;
  if (z <= 9)  return 48;
  return 58;
};

const HeatmapLayer = ({ earthquakes }) => {
  const map = useMap();
  const heatRef = useRef(null);
  const [pluginReady, setPluginReady] = useState(false);

  // Load leaflet.heat once — must set window.L before the dynamic import
  useEffect(() => {
    window.L = L;
    import("leaflet.heat").then(() => setPluginReady(true));
  }, []);

  const rebuild = useCallback(() => {
    if (!pluginReady) return;
    if (heatRef.current) { map.removeLayer(heatRef.current); heatRef.current = null; }
    if (earthquakes.length === 0) return;

    const zoom = map.getZoom();
    const r    = heatRadius(zoom);

    const points = earthquakes.map(q => {
      const lat = parseFloat(q.Latitude);
      const lng = parseFloat(q.Longitude);
      const mag = parseFloat(q.Mw_mean);
      if (isNaN(lat) || isNaN(lng) || isNaN(mag)) return null;
      // Density-first weighting: small magnitude bonus so notable events add slight extra
      // prominence without letting a handful of M5+ events dominate the whole picture.
      // Mw <4 → 1.0  |  Mw 4–5 → 1.15  |  Mw 5+ → 1.3
      const wt = mag >= 5.0 ? 1.3 : mag >= 4.0 ? 1.15 : 1.0;
      return [lat, lng, wt];
    }).filter(Boolean);

    heatRef.current = L.heatLayer(points, {
      radius:     r,
      blur:       Math.round(r * 0.5),  // 50% of radius — tighter than before, less muddy
      max:        1.3,                  // matches new max weight so full gradient is used
      minOpacity: 0.25,                 // lower floor → sparse scatter stays subtle
      gradient:   HEAT_GRADIENT,
    }).addTo(map);

    // The heat canvas is treated as an image by the browser, so right-click
    // shows "Save image as" instead of the normal page menu.  Disabling
    // pointer-events lets clicks fall through to the map container div,
    // which shows the standard context menu.  Pan/zoom is unaffected
    // because Leaflet listens on the container, not on overlay canvases.
    if (heatRef.current._canvas) {
      heatRef.current._canvas.style.pointerEvents = "none";
    }
  }, [map, earthquakes, pluginReady]);

  useEffect(() => {
    rebuild();
    return () => {
      if (heatRef.current) { map.removeLayer(heatRef.current); heatRef.current = null; }
    };
  }, [map, rebuild]);

  // Re-draw on zoom to apply correct radius — panning does not need a redraw
  useEffect(() => {
    map.on("zoomend", rebuild);
    return () => { map.off("zoomend", rebuild); };
  }, [map, rebuild]);

  return null;
};

const HeatmapLegend = () => (
  <div className="heatmap-legend">
    <div className="heatmap-legend-title">Earthquake density</div>
    <div className="heatmap-legend-bar" />
    <div className="heatmap-legend-labels">
      <span>Low</span>
      <span>High</span>
    </div>
  </div>
);

const MapComponent = ({
  earthquakes,
  volcanoes = [],
  maxMagnitude,
  onMapTypeChange,
  showVolcanoes,
  toggleVolcanoes,
  colorOwner,
  onChangeColorOwner,
  isDarkMode,
}) => {
  const [selectedEarthquake, setSelectedEarthquake] = useState(null);
  const [selectedVolcano, setSelectedVolcano] = useState(null);
  const [showGrid, setShowGrid] = useState(false);
  const [mapType, setMapType] = useState("roadmap");
  const [shakeUrl, setShakeUrl] = useState(null);

  // Auto-deselect if quake disappears
  useEffect(() => {
    if (!selectedEarthquake) return;
    const still = earthquakes.some(
      (q) =>
        q["Date-time"] === selectedEarthquake["Date-time"] &&
        q.Latitude === selectedEarthquake.Latitude &&
        q.Longitude === selectedEarthquake.Longitude
    );
    if (!still) setSelectedEarthquake(null);
  }, [earthquakes, selectedEarthquake]);

  // Auto-close after 15 s
  useEffect(() => {
    if (!selectedEarthquake) return;
    const t = setTimeout(() => setSelectedEarthquake(null), 15000);
    return () => clearTimeout(t);
  }, [selectedEarthquake]);

  useEffect(() => {
    if (!selectedVolcano) return;
    const t = setTimeout(() => setSelectedVolcano(null), 15000);
    return () => clearTimeout(t);
  }, [selectedVolcano]);

  useEffect(() => {
    let cancelled = false;
    async function look() {
      setShakeUrl(null);
      if (!selectedEarthquake) return;
      try {
        const data = await fetchShakeMapValidated(
          selectedEarthquake["Date-time"],
          selectedEarthquake.Latitude,
          selectedEarthquake.Longitude
        );
        if (!cancelled) setShakeUrl(data);
      } catch {
        if (!cancelled) setShakeUrl(null);
      }
    }
    look();
    return () => { cancelled = true; };
  }, [selectedEarthquake]);

  const handleMapTypeChange = useCallback((type) => {
    if (type === "heatmap") {
      setSelectedEarthquake(null);
      setSelectedVolcano(null);
    }
    setMapType(type);
    onMapTypeChange(type);
  }, [onMapTypeChange]);

  const handleMarkerClick  = useCallback((quake)   => { setSelectedVolcano(null);    setSelectedEarthquake(quake);   }, []);
  const handleVolcanoClick = useCallback((volcano) => { setSelectedEarthquake(null); setSelectedVolcano(volcano);    }, []);
  const handleMapClick     = useCallback(()        => { setSelectedEarthquake(null); setSelectedVolcano(null);       }, []);

  const markerIcons = useMemo(() =>
    earthquakes.map((quake) => {
      const magnitude = parseFloat(quake.Mw_mean);
      const color =
        colorOwner === "timeline"
          ? getTwilightColorForDate(quake["Date-time"])
          : getMarkerColor(magnitude, maxMagnitude);
      const px = getMarkerPixelSize(magnitude, maxMagnitude);
      return { px, color };
    }),
    [earthquakes, colorOwner, maxMagnitude]
  );

  return (
    <div className="map-container" style={{ position: "relative" }}>
      <div className="map-type-control">
        <MapTypeSelector onMapTypeChange={handleMapTypeChange} />
      </div>

      {mapType !== "heatmap" && (
        <div className="color-toggle-container">
          <div className="color-mode-switch">
            <button className={colorOwner === "timeline" ? "active" : ""} onClick={() => onChangeColorOwner("timeline")}>
              Timeline colors
            </button>
            <button className={colorOwner === "magnitude" ? "active" : ""} onClick={() => onChangeColorOwner("magnitude")}>
              Magnitude colors
            </button>
          </div>
        </div>
      )}

      <div className="volcano-toggle-container">
        <div className="volcano-toggle">
          <label className="switch">
            <input type="checkbox" checked={showVolcanoes} onChange={toggleVolcanoes} />
            <span className="slider round"></span>
          </label>
          <span className="toggle-label">Show volcanoes</span>
        </div>
        <div className="volcano-toggle grid-toggle">
          <label className="switch">
            <input type="checkbox" checked={showGrid} onChange={() => setShowGrid((v) => !v)} />
            <span className="slider round"></span>
          </label>
          <span className="toggle-label">Show lat-lon grid</span>
        </div>
      </div>

      <MapContainer
        center={CENTER}
        zoom={6}
        minZoom={5.5}
        style={{ width: "100vw", height: "100vh" }}
        zoomControl={false}
        attributionControl={true}
        zoomAnimation={true}
        fadeAnimation={true}
        markerZoomAnimation={true}
        preferCanvas={true}        // render markers on canvas — much faster redraws
        zoomSnap={0.5}             // snap to 0.5 zoom increments instead of integers — smoother steps
        zoomDelta={0.5}            // one scroll gesture = 0.5 zoom levels — prevents aggressive jumps
        wheelPxPerZoomLevel={60}   // default 60px per level; combined with zoomDelta=0.5 this means ~120px of scroll per full integer zoom
      >
        <TileLayerManager mapType={mapType} />
        <MapPanes />
        <MinZoomController mapType={mapType} />
        <MapReadyHandler />
        <ScaleControl position="bottomright" />
        <GridOverlay show={showGrid} isDarkMode={isDarkMode} mapType={mapType} />
        <MapClickHandler onClick={handleMapClick} />

        <EarthquakeMarkers
          earthquakes={earthquakes}
          markerIcons={markerIcons}
          selectedEarthquake={selectedEarthquake}
          onMarkerClick={handleMarkerClick}
          visible={mapType !== "heatmap"}
        />
        {mapType === "heatmap" && <HeatmapLayer earthquakes={earthquakes} />}

        {showVolcanoes &&
          volcanoes.map((volcano, index) => (
            <VolcanoMarker
              key={`volcano-${index}`}
              volcano={volcano}
              onSelect={handleVolcanoClick}
            />
          ))}
      </MapContainer>

      {mapType === "heatmap" && <HeatmapLegend />}

      {selectedEarthquake && (
        <div className="earthquake-info">
          <p><b>Magnitude: {selectedEarthquake.Mw_mean ?? "N/A"}</b></p>
          <p><strong>Depth:</strong> {selectedEarthquake.Depth} km</p>
          <p className="eq-time"><strong>Time:</strong> {selectedEarthquake["Date-time"]}</p>
          <p><strong>Lat:</strong> {selectedEarthquake.Latitude}</p>
          <p><strong>Lon:</strong> {selectedEarthquake.Longitude}</p>
          {shakeUrl && shakeUrl.url && (
            <button
              onClick={() => window.open(shakeUrl.url, "_blank", "noopener,noreferrer")}
              style={{ marginTop: "6px" }}
              title={`ShakeMap (Δt ${Math.round(shakeUrl.dt_sec)} s, Δd ${shakeUrl.dist_km?.toFixed(1)} km, ΔM ${shakeUrl.dm ?? "–"})`}
            >
              ShakeMap
            </button>
          )}
          <button onClick={() => setSelectedEarthquake(null)}>Close</button>
        </div>
      )}

      {selectedVolcano && (
        <div className="volcano-info" style={{ maxWidth: "220px" }}>
          <h3>{selectedVolcano.name}</h3>
          {selectedVolcano.description && <p>{selectedVolcano.description}</p>}
          <p>
            <strong>Elevation:</strong>{" "}
            {Number.isFinite(+selectedVolcano.elevation_m) && +selectedVolcano.elevation_m > 0
              ? `${Math.round(+selectedVolcano.elevation_m)} m (${Math.round(+selectedVolcano.elevation_m * 3.28084)} ft)`
              : "Unknown"}
          </p>
          <p>
            <strong>Location:</strong>{" "}
            {`${Number(selectedVolcano.latitude).toFixed(3)}°, ${Number(selectedVolcano.longitude).toFixed(3)}°`}
          </p>
          <button onClick={() => setSelectedVolcano(null)}>Close</button>
        </div>
      )}
    </div>
  );
};

export default MapComponent;
