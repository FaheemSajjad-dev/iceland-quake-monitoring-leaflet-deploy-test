import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { MapContainer, TileLayer, Pane, ScaleControl, AttributionControl, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import maplibregl from "maplibre-gl";
import "@maplibre/maplibre-gl-leaflet";
import { Protocol } from "pmtiles";
import pmLayers from "protomaps-themes-base";
import MapTypeSelector from "./MapTypeSelector";
import VolcanoMarker from "./VolcanoMarker";
import "./MapComponent.css";
import { fetchShakeMapValidated } from "../api";
import { parseBackendUtcDate } from "../utils/datetime";

// Register pmtiles:// protocol with MapLibre GL once at module load.
// This lets MapLibre fetch a single .pmtiles file via HTTP range requests
// instead of hitting a tile server for every tile.
const _pmtilesProtocol = new Protocol();
maplibregl.addProtocol("pmtiles", _pmtilesProtocol.tile.bind(_pmtilesProtocol));

const CENTER = [64.9631, -19.0208];

const MIN_MAG = 2.7;
const MAG_PALETTE_STOPS = ["#8aa0c0", "#5a7098", "#344870", "#1a2450", "#060820"];

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
const MARKER_PX = 10;

const TWILIGHT_MONTH_COLORS = [
  "#b07888", // Jan
  "#a06878", // Feb
  "#905868", // Mar
  "#804858", // Apr
  "#6e3848", // May
  "#5e2c3c", // Jun
  "#4e2030", // Jul
  "#3e1626", // Aug
  "#2e0e1c", // Sep
  "#200814", // Oct
  "#14040c", // Nov
  "#0c0208", // Dec
];
const getTwilightColorForDate = (isoString) => {
  if (!isoString) return "#6a51a3";
  const d = parseBackendUtcDate(isoString);
  if (!d) return "#6a51a3";
  return TWILIGHT_MONTH_COLORS[d.getUTCMonth()] || "#6a51a3";
};

// All tile layers now use Esri's ArcGIS REST CDN — the same infrastructure used
// by the Icelandic Met Office's own Skjálftalísa app (esri-leaflet).
// No API key required. Tile URL format: /MapServer/tile/{z}/{y}/{x}
const TILE_LAYERS = {
  roadmap: null, // handled by MaplibreVectorLayer
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics",
    maxZoom: 19,
    maxNativeZoom: 17, // Esri World Imagery native cap; above 17 Leaflet up-scales existing tiles
  },
  dark_mode: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ",
    maxZoom: 19,
    maxNativeZoom: 16,
  },
};

// Shared tile options applied to every basemap layer — key for zoom smoothness.
// esri-leaflet's basemapLayer() extends L.TileLayer, so all standard options apply.
const TILE_PROPS = {
  updateWhenZooming: false, // do not fetch new tiles during CSS zoom animation; scaled copies of existing tiles are shown instead — eliminates blank tile flicker
  updateWhenIdle:    false, // fetch new tiles immediately after zoom/pan settles, not deferred (better on desktop)
  keepBuffer:        4,     // pre-load 4 extra tile rows in every direction — greatly reduces blank edges when panning or zooming
  detectRetina:      false, // do not request 2× tiles; avoids over-requesting on retina screens
};

// Layers to strip entirely from the default "light" theme.
const PMTILES_REMOVE_LAYERS = new Set([
  "landuse_park",
  "landuse_urban_green",
  "landuse_hospital",
  "landuse_industrial",
  "landuse_school",
  "landuse_zoo",
  "landuse_aerodrome",
  "landuse_runway",
  "landuse_pedestrian",
  "landuse_pier",
  "roads_runway",
  "roads_taxiway",
  "roads_pier",
  "roads_rail",
  "buildings",
  "address_label",
  "pois",                // peaks, parks, marinas — all unwanted on this map
  "landcover",           // replaced by glacier_landuse below
]);

const GLACIER_PAINT = { "fill-color": "#dff2fb", "fill-opacity": 1 };

function buildPmtilesLayers() {
  const layers = pmLayers("protomaps", "light")
    .filter(l => !PMTILES_REMOVE_LAYERS.has(l.id))
    .map(l => {
      // Background: default is gray (#cccccc) which leaks outside the tile bbox.
      // Use water color so any out-of-data area reads as ocean, not blank gray.
      if (l.id === "background") {
        return { ...l, paint: { "background-color": "#80deea" } };
      }
      return l;
    });

  // Single glacier layer using landuse source (zoom 2-15) — covers all zoom levels.
  // Insert right after "earth" so it renders beneath roads/labels.
  const earthIdx = layers.findIndex(l => l.id === "earth");
  layers.splice(earthIdx + 1, 0, {
    id: "glacier_landuse",
    type: "fill",
    source: "protomaps",
    "source-layer": "landuse",
    filter: ["==", ["get", "kind"], "glacier"],
    paint: GLACIER_PAINT,
  });

  return layers;
}

// Fully self-hosted PMTiles style — tiles, glyphs, and sprites all served locally.
// No external CDN dependencies.
const _base = import.meta.env.BASE_URL.replace(/\/$/, '');
const buildPmtilesStyle = () => ({
  version: 8,
  glyphs: `${window.location.origin}${_base}/fonts/pbf/{fontstack}/{range}.pbf`,
  sprite: `${window.location.origin}${_base}/sprites/v4/light`,
  sources: {
    protomaps: {
      type: "vector",
      url: `pmtiles://${window.location.origin}${_base}/tiles/iceland.pmtiles`,
      attribution: "&copy; <a href='https://openstreetmap.org'>OpenStreetMap</a> contributors",
    },
  },
  layers: buildPmtilesLayers(),
});

const MaplibreVectorLayer = ({ onReady }) => {
  const map = useMap();
  useEffect(() => {
    const gl = L.maplibreGL({
      style: buildPmtilesStyle(),
      attribution: "&copy; <a href='https://openstreetmap.org'>OpenStreetMap</a> contributors",
      fadeDuration: 0,
      collectResourceTiming: false,
      trackResize: false,
      pixelRatio: 1,
      maxTileCacheSize: 20,
      antialias: false,
    }).addTo(map);

    // Disable all MapLibre interaction handlers — Leaflet is the sole controller.
    const mlMap = gl.getMaplibreMap();
    mlMap.scrollZoom.disable();
    mlMap.dragPan.disable();
    mlMap.dragRotate.disable();
    mlMap.keyboard.disable();
    mlMap.doubleClickZoom.disable();
    mlMap.touchZoomRotate.disable();
    mlMap.boxZoom.disable();

    // Make the MapLibre canvas non-interactive so events reach Leaflet layers.
    const canvas = mlMap.getCanvas();
    canvas.style.pointerEvents = "none";

    // Lower the GL container z-index so it sits beneath Leaflet marker panes.
    const glContainer = mlMap.getContainer().parentElement;
    if (glContainer) {
      glContainer.style.zIndex = "200";
      glContainer.style.pointerEvents = "none";
    }

    // Fire once when the first full render pass is complete — all visible tiles painted.
    mlMap.once("idle", () => onReady?.());

    // Ensure the GL canvas is correctly sized on initial load (trackResize:false
    // means MapLibre won't auto-detect the container size at startup).
    setTimeout(() => mlMap.resize(), 100);
    setTimeout(() => mlMap.resize(), 500);

    // Forward Leaflet resize events (e.g. F11 fullscreen) to MapLibre GL,
    // since trackResize:false prevents it from auto-detecting viewport changes.
    // Two-stage resize: immediate call handles normal window resizes; the
    // deferred call (300 ms) handles fullscreen transitions where the browser
    // fires the resize event before the viewport has settled to its final size.
    let resizeTimer = null;
    const handleResize = () => {
      mlMap.resize();
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => mlMap.resize(), 300);
    };
    map.on("resize", handleResize);

    // Also catch fullscreenchange directly — some browsers complete the
    // transition after the resize event, so we need a second resize pass.
    const handleFullscreen = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        map.invalidateSize();
        mlMap.resize();
      }, 300);
    };
    document.addEventListener("fullscreenchange", handleFullscreen);
    document.addEventListener("webkitfullscreenchange", handleFullscreen);

    return () => {
      clearTimeout(resizeTimer);
      map.off("resize", handleResize);
      document.removeEventListener("fullscreenchange", handleFullscreen);
      document.removeEventListener("webkitfullscreenchange", handleFullscreen);
      map.removeLayer(gl);
    };
  }, [map]);
  return null;
};

const TileLayerManager = ({ mapType, onReady }) => {
  if (mapType === "roadmap") return <MaplibreVectorLayer onReady={onReady} />;
  if (mapType === "heatmap") {
    return (
      <>
        <TileLayer
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
          attribution="Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ"
          maxZoom={19}
          maxNativeZoom={16}
          zIndex={1}
          eventHandlers={{ load: onReady }}
          {...TILE_PROPS}
        />
        <Pane name="heatmap-labels" style={{ zIndex: 650 }}>
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}"
            attribution=""
            maxZoom={19}
            maxNativeZoom={16}
            {...TILE_PROPS}
          />
        </Pane>
      </>
    );
  }
  const layer = TILE_LAYERS[mapType];
  return (
    <TileLayer
      key={mapType}
      url={layer.url}
      attribution={layer.attribution}
      maxZoom={layer.maxZoom}
      maxNativeZoom={layer.maxNativeZoom}
      eventHandlers={{ load: onReady }}
      {...TILE_PROPS}
    />
  );
};

// Bounding box used to auto-fit Iceland on any screen size.
const ICELAND_FIT_BOUNDS = [[63.0, -24.5], [66.6, -13.0]];

// Fit Iceland to the viewport on initial mount, then lock minZoom to that level
// so the user cannot zoom out further than the "full island" view on any screen.
const FitIcelandOnReady = () => {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(ICELAND_FIT_BOUNDS, { padding: [10, 10], animate: false });
    const fitZoom = map.getBoundsZoom(L.latLngBounds(ICELAND_FIT_BOUNDS), false, [10, 10]);
    map.setMinZoom(Math.max(4.5, fitZoom - 0.5));
  }, [map]);
  return null;
};

// Ensures the map measures its container correctly if CSS finishes after initial render.
const MapReadyHandler = () => {
  const map = useMap();
  useEffect(() => {
    const id1 = setTimeout(() => map.invalidateSize(), 150);
    const id2 = setTimeout(() => map.invalidateSize(), 500);
    return () => { clearTimeout(id1); clearTimeout(id2); };
  }, [map]);
  return null;
};

// Prevents scroll-wheel events from accumulating while a zoom animation is
// still playing. Without this, fast scrolling queues extra zoom steps during
// the ~250 ms CSS animation, causing multi-zoom and direction-inversion bugs.
//
// We patch _performZoom (not disable/enable the handler) so that Leaflet's
// wheel listener remains active and keeps calling preventDefault() on every
// wheel event — preventing the browser from zooming the page instead.
const ZoomAnimGuard = () => {
  const map = useMap();
  useEffect(() => {
    const handler = map.scrollWheelZoom;
    const original = handler._performZoom.bind(handler);
    let animating = false;

    let lastZoom = 0;
    const COOLDOWN = 250; // matches Leaflet's CSS zoom animation duration

    handler._performZoom = function () {
      const now = Date.now();
      if (animating || now - lastZoom < COOLDOWN) {
        // Discard accumulated delta so it doesn't bleed into the next zoom.
        this._delta = 0;
        this._startTime = null;
        return;
      }
      lastZoom = now;
      original();
    };

    const lock   = () => { animating = true; };
    const unlock = () => { animating = false; };
    map.on("zoomstart", lock);
    map.on("zoomend",   unlock);

    return () => {
      handler._performZoom = original;
      map.off("zoomstart", lock);
      map.off("zoomend",   unlock);
    };
  }, [map]);
  return null;
};

const MapClickHandler = ({ onClick }) => {
  useMapEvents({ click: onClick });
  return null;
};

// Leaflet registers a bubble-phase contextmenu listener on the map container
// that calls preventDefault(), suppressing the browser's native right-click menu.
// This component intercepts that event in the capture phase and calls
// stopPropagation() so Leaflet's handler never runs, restoring the default menu.
const ContextMenuEnabler = () => {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const handler = (e) => { e.stopPropagation(); };
    container.addEventListener('contextmenu', handler, true);
    return () => container.removeEventListener('contextmenu', handler, true);
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
        L.polyline(coords, { color, weight, opacity, interactive: false }).addTo(map)
      );
    };
    const addLabel = (lat, lng, text, color, size, fontWeight = "bold") => {
      gridRef.current.push(
        L.marker([lat, lng], {
          icon: L.divIcon({
            className: "grid-label-icon",
            html: `<span style="color:${color};font-size:${size};font-weight:${fontWeight};white-space:nowrap;pointer-events:none;">${text}</span>`,
            iconSize: [80, 16],
            iconAnchor: [0, 8],
          }),
          interactive: false,
          zIndexOffset: -9000,
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
  radius: isSelected ? 7 : 5,
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
  const markersMapRef = useRef(new Map());
  const prevSelectedRef = useRef(null);
  const selectedEqRef = useRef(selectedEarthquake);
  const markerIconsRef = useRef(markerIcons);
  selectedEqRef.current = selectedEarthquake;
  markerIconsRef.current = markerIcons;

  useEffect(() => {
    const lg = L.layerGroup().addTo(map);
    layerGroupRef.current = lg;
    return () => {
      map.removeLayer(lg);
      layerGroupRef.current = null;
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
    // Sort ascending by magnitude so higher-magnitude markers are added last
    // and appear on top in the SVG stack (higher effective z-index).
    const sorted = earthquakes
      .map((q, i) => ({ q, i, mag: parseFloat(q.Mw_mean) || 0 }))
      .sort((a, b) => a.mag - b.mag);

    sorted.forEach(({ q: quake, i: index }) => {
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
      entry.marker.setRadius(isSelected ? 7 : 5);
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
  const [mapReady, setMapReady] = useState(false);
  const handleMapReady = useCallback(() => setMapReady(true), []);

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

  useEffect(() => {
    if (!selectedEarthquake) return;
    const t = setTimeout(() => setSelectedEarthquake(null), 15000);
    return () => clearTimeout(t);
  }, [selectedEarthquake]);

  useEffect(() => {
    if (!selectedVolcano) return;
    const t = setTimeout(() => setSelectedVolcano(null), 15_000);
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
      return { px: MARKER_PX, color };
    }),
    [earthquakes, colorOwner, maxMagnitude]
  );

  return (
    <div className="map-container" style={{ position: "relative" }}>
      {!mapReady && (
        <div className="map-loading-overlay">
          <span>Loading map…</span>
        </div>
      )}
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
        minZoom={4.5}
        maxBounds={[[62, -25], [68.5, -12]]}
        maxBoundsViscosity={1.0}
        style={{ width: "100vw", height: "100vh" }}
        zoomControl={false}
        attributionControl={false}
        zoomAnimation={true}
        fadeAnimation={true}
        markerZoomAnimation={true}
        preferCanvas={false}       // SVG renderer: right-click on markers shows normal browser context menu (canvas would show "Save image as")
        zoomSnap={0.5}             // snap to 0.5 zoom increments instead of integers — smoother steps
        zoomDelta={0.5}            // zoom button / keyboard step = 0.5 levels (does NOT affect scroll wheel)
        wheelPxPerZoomLevel={120}  // 120px of scroll per zoom level → ~1 notch = 0.5 levels (one snap step)
      >
        <TileLayerManager mapType={mapType} onReady={handleMapReady} />
        <FitIcelandOnReady />
        <MapReadyHandler />
        <ZoomAnimGuard />
        <ContextMenuEnabler />
        <AttributionControl position="bottomright" prefix={false} />
        <ScaleControl position="bottomright" />
        <GridOverlay show={showGrid} isDarkMode={isDarkMode} mapType={mapType} />
        <MapClickHandler onClick={handleMapClick} />

        {mapReady && (
          <EarthquakeMarkers
            earthquakes={earthquakes}
            markerIcons={markerIcons}
            selectedEarthquake={selectedEarthquake}
            onMarkerClick={handleMarkerClick}
            visible={mapType !== "heatmap"}
          />
        )}
        {mapReady && mapType === "heatmap" && <HeatmapLayer earthquakes={earthquakes} />}

        {mapReady && showVolcanoes &&
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
