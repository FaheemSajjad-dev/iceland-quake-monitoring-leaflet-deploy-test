import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { MapContainer, TileLayer, ScaleControl, AttributionControl, useMap, useMapEvents } from "react-leaflet";
import MapLibreMap, { NavigationControl, Source, Layer, Marker, ScaleControl as MapLibreScaleControl, useControl } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ScatterplotLayer } from "@deck.gl/layers";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "maplibre-gl";
import "@maplibre/maplibre-gl-leaflet";
import VolcanoMarker from "./VolcanoMarker";
import FaultsOverlay from "./FaultsOverlay";
import "./MapComponent.css";
import { fetchShakeMapValidated } from "../api";
import { parseBackendUtcDate } from "../utils/datetime";
import { useT } from "../i18n";

const CENTER = [64.9631, -19.0208];
const ICELAND_CENTER = {
  longitude: -19.0208,
  latitude: 64.9631,
};
const ICELAND_VIEW = {
  longitude: ICELAND_CENTER.longitude,
  latitude: ICELAND_CENTER.latitude,
  zoom: 5.5,
  pitch: 0,
  bearing: 0,
};
const ICELAND_BOUNDS_LNG_LAT = [
  [-36, 58],
  [-4, 72],
];

const MIN_MAG = 3.0;
const MAG_PALETTE_STOPS = ["#f5a623", "#e07030", "#c43c28", "#8f1a1a", "#4a0a0a"];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const getLeftControlRightPx = () => {
  if (typeof window === "undefined" || typeof document === "undefined") return 185;
  const drawer = document.querySelector(".left-panel:not(.left-panel--collapsed) .left-panel__drawer");
  const rect = drawer?.getBoundingClientRect?.();
  if (!rect || rect.width <= 1) return 0;
  return clamp(rect.right, 0, Math.max(0, window.innerWidth - 1));
};

const getDefaultIcelandView = ({ tileSize, minZoom = 4 } = {}) => {
  if (typeof window === "undefined") return { ...ICELAND_VIEW, zoom: minZoom };
  const leftControlRight = getLeftControlRightPx();
  const zoom = minZoom;
  const degreesPerPixel = 360 / (tileSize * (2 ** zoom));
  const longitude = ICELAND_CENTER.longitude - (leftControlRight / 2) * degreesPerPixel;
  return {
    longitude,
    latitude: ICELAND_CENTER.latitude,
    zoom,
    pitch: 0,
    bearing: 0,
  };
};

const getDefaultMapLibreView = () => getDefaultIcelandView({ tileSize: 512, minZoom: 4, maxZoom: 18 });
const getDefaultLeafletView = () => {
  const view = getDefaultIcelandView({ tileSize: 256, minZoom: 4.5, maxZoom: 18 });
  return {
    center: [view.latitude, view.longitude],
    zoom: view.zoom,
  };
};

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

/* Timeline colour palette — North Atlantic ocean depth, oldest (dark navy) → newest (bright teal).
   Stops mirror the TimeWindowSlider track gradient exactly, mapped by year.
   Year-based (not month) so each earthquake's dot matches its position on the slider. */
const TIMELINE_YEAR_STOPS = [
  "#0a1628", // 2020 — deep navy (oldest)
  "#164068", // 2021
  "#2874aa", // 2022
  "#3590c0", // 2023
  "#45add4", // 2024
  "#5ec4de", // 2025
  "#78d8e8", // 2026 — bright teal (most recent)
];
const SATELLITE_TIMELINE_YEAR_STOPS = [
  "#3b063f",
  "#5d0a62",
  "#7f117f",
  "#a31997",
  "#c026a8",
  "#dc3fba",
  "#ff8adb",
];
const TIMELINE_BASE_YEAR = 2020;

const getTimelineColorForDate = (isoString, palette = TIMELINE_YEAR_STOPS) => {
  if (!isoString) return palette[3];
  const d = parseBackendUtcDate(isoString);
  if (!d) return palette[3];
  const idx = Math.max(0, Math.min(
    palette.length - 1,
    d.getUTCFullYear() - TIMELINE_BASE_YEAR
  ));
  return palette[idx];
};

// Raster basemap definitions used by Leaflet-only views and non-vector fallbacks.
// The default Map layer is rendered by MapLibre with OpenFreeMap Positron.
const TILE_LAYERS = {
  roadmap: {
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
    maxZoom: 19,
    maxNativeZoom: 18,
    subdomains: "abcd",
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 19,
    maxNativeZoom: 17,
  },
  terrain: {
    url: "https://geo.vedur.is/geoserver/www/imo_basemap_epsg3857/{z}/{x}/{y}.png",
    maxZoom: 19,
    maxNativeZoom: 14,
  },
};

// Shared tile options used to reduce flicker while panning and zooming.
const TILE_PROPS = {
  updateWhenZooming: false, // scaled existing tiles are shown during CSS zoom animation
  updateWhenIdle:    false, // fetch new tiles immediately after zoom/pan settles, not deferred (better on desktop)
  keepBuffer:        4,     // preload extra tile rows to reduce blank edges during movement
  detectRetina:      false, // avoids over-requesting on high-density screens
};

const OPENFREEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
const buildRasterMapStyle = (sourceId, layerId, source) => ({
  version: 8,
  sources: {
    [sourceId]: {
      type: "raster",
      tiles: source.tiles,
      tileSize: source.tileSize,
      maxzoom: source.maxzoom,
      attribution: source.attribution,
    },
  },
  layers: [
    { id: layerId, type: "raster", source: sourceId },
  ],
});

const MAPLIBRE_RASTER_SOURCES = {
  satellite: {
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    tileSize: 256,
    maxzoom: 17,
    attribution: "Esri | Maxar | Earthstar Geographics",
  },
  terrain: {
    tiles: ["https://geo.vedur.is/geoserver/www/imo_basemap_epsg3857/{z}/{x}/{y}.png"],
    tileSize: 256,
    maxzoom: 14,
    attribution: "Icelandic Met Office | Natural Science Institute of Iceland | OpenStreetMap",
  },
};

const MAPLIBRE_STYLES = {
  roadmap: OPENFREEMAP_STYLE_URL,
  satellite: buildRasterMapStyle("esri-satellite", "esri-satellite-layer", MAPLIBRE_RASTER_SOURCES.satellite),
  terrain: buildRasterMapStyle("imo-basemap", "imo-basemap-layer", MAPLIBRE_RASTER_SOURCES.terrain),
};

const colorStringToDeckRgba = (color, alpha = 230) => {
  if (!color) return [136, 136, 136, alpha];
  if (color.startsWith("#")) {
    const { r, g, b } = hexToRgb(color);
    return [r, g, b, alpha];
  }
  const match = color.match(/\d+/g);
  if (!match || match.length < 3) return [136, 136, 136, alpha];
  return [Number(match[0]), Number(match[1]), Number(match[2]), alpha];
};

const getDeckMarkerRadius = (zoom, isSelected) => getMarkerRadius(zoom, isSelected);

const COMPACT_ATTRIBUTIONS = {
  roadmap: "<a href='https://openfreemap.org/'>OpenFreeMap</a> | <a href='https://openmaptiles.org/'>OpenMapTiles</a> | <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a>",
  satellite: "<a href='https://www.esri.com/'>Esri</a> | Maxar | Earthstar Geographics",
  terrain: "<a href='https://www.vedur.is/'>IMO</a> | Natural Science Institute of Iceland | <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a>",
  heatmap: "<a href='https://carto.com/attributions'>CARTO</a> | <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a>",
};
const MOBILE_ATTRIBUTIONS = {
  roadmap: "<a href='https://openfreemap.org/'>OFM</a> | <a href='https://www.openstreetmap.org/copyright'>OSM</a>",
  satellite: "<a href='https://www.esri.com/'>Esri</a>",
  terrain: "<a href='https://www.vedur.is/'>IMO</a> | <a href='https://www.openstreetmap.org/copyright'>OSM</a>",
  heatmap: "<a href='https://carto.com/attributions'>CARTO</a> | <a href='https://www.openstreetmap.org/copyright'>OSM</a>",
};
const FAULTS_ATTRIBUTION = "<a href='https://metadata.europe-geology.eu/record/basic/604a286d-bab0-46be-9e9e-46940a010833'>EGDI/HIKE, ISOR</a>";
const MOBILE_FAULTS_ATTRIBUTION = "<a href='https://metadata.europe-geology.eu/record/basic/604a286d-bab0-46be-9e9e-46940a010833'>EGDI/HIKE</a>";
const HIKE_METADATA_URL = "https://metadata.europe-geology.eu/record/basic/604a286d-bab0-46be-9e9e-46940a010833";

// Prefer Icelandic names, fall back to local OSM name
const IS_NAME_EXPR = ["coalesce", ["get", "name:is"], ["get", "name"]];

const GLACIER_FILTER = [
  "any",
  ["==", ["get", "class"], "glacier"],
  ["==", ["get", "subclass"], "glacier"],
  ["==", ["get", "class"], "ice"],
  ["==", ["get", "subclass"], "ice"],
];

const GLACIER_LABELS = [
  { name: "Vatnajökull", lat: 64.40, lng: -16.80, minZoom: 4.5, priority: 1 },
  { name: "Langjökull", lat: 64.70, lng: -20.20, minZoom: 4.5, priority: 2 },
  { name: "Hofsjökull", lat: 64.80, lng: -18.90, minZoom: 4.5, priority: 3 },
  { name: "Drangajökull", lat: 66.20, lng: -22.20, minZoom: 4.5, priority: 4 },
  { name: "Snæfellsjökull", lat: 64.81, lng: -23.78, minZoom: 5.2, priority: 5 },
  { name: "Eiríksjökull", lat: 64.77, lng: -20.40, minZoom: 5.2, priority: 6 },
  { name: "Mýrdalsjökull", lat: 63.70, lng: -19.10, minZoom: 5.4, priority: 7 },
  { name: "Öræfajökull", lat: 64.10, lng: -17.50, minZoom: 6.0, priority: 8 },
  { name: "Tungnaárjökull", lat: 64.60, lng: -18.10, minZoom: 6.2, priority: 9 },
  { name: "Eyjafjallajökull", lat: 63.60, lng: -19.60, minZoom: 6.4, priority: 10 },
];

const GLACIER_LABELS_GEOJSON = {
  type: "FeatureCollection",
  features: GLACIER_LABELS.map(({ name, lat, lng, minZoom }) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties: { name, minZoom },
  })),
};

const HIDDEN_ROADMAP_LAYERS = new Set(["park", "landcover_wood"]);

const getGlacierLabelSize = (zoom) => {
  if (zoom < 5.2) return 10;
  if (zoom < 6.0) return 11;
  return 12;
};

const glacierLabelIcon = (name, zoom) => {
  const fontSize = getGlacierLabelSize(zoom);
  const width = fontSize <= 10 ? 96 : fontSize <= 11 ? 108 : 120;
  return L.divIcon({
    className: "glacier-label-icon",
    html: `<span style="font-size:${fontSize}px;width:${width}px;">${name}</span>`,
    iconSize: [width, fontSize + 6],
    iconAnchor: [width / 2, Math.round((fontSize + 6) / 2)],
  });
};

const glacierLabelBounds = (map, label, zoom) => {
  const fontSize = getGlacierLabelSize(zoom);
  const width = Math.max(fontSize * label.name.length * 0.62, fontSize <= 10 ? 74 : 84);
  const height = fontSize + 8;
  const point = map.latLngToContainerPoint([label.lat, label.lng]);
  return {
    left: point.x - width / 2,
    right: point.x + width / 2,
    top: point.y - height / 2,
    bottom: point.y + height / 2,
  };
};

const overlaps = (a, b, padding = 6) =>
  a.left < b.right + padding &&
  a.right + padding > b.left &&
  a.top < b.bottom + padding &&
  a.bottom + padding > b.top;

// Cached raw style promise — one fetch shared by roadmap and labels overlay
let _rawStylePromise = null;
const fetchRawStyle = () => {
  if (!_rawStylePromise)
    _rawStylePromise = fetch(OPENFREEMAP_STYLE_URL).then(r => r.json());
  return _rawStylePromise;
};

const LABEL_THEMES = {
  dark: {
    textColor: "#f8fafc",
    haloColor: "rgba(6, 12, 20, 0.92)",
    haloWidth: 2.6,
  },
  light: {
    textColor: "#202733",
    haloColor: "rgba(255, 255, 255, 0.94)",
    haloWidth: 1.8,
  },
};

const normalizeTextFont = (font) => {
  const fallback = ["Noto Sans Regular"];
  if (!font) return fallback;
  if (!Array.isArray(font)) return fallback;
  if (font.some((name) => typeof name === "string" && /open sans|arial unicode/i.test(name))) {
    return fallback;
  }
  return font;
};

const insertGlacierLayers = (raw, layers) => {
  const source = Object.entries(raw.sources ?? {}).find(([, value]) => value?.type === "vector")?.[0];
  if (!source) return layers;

  const glacierLayers = [
    {
      id: "__iceland_glacier_fill__",
      type: "fill",
      source,
      "source-layer": "landcover",
      filter: GLACIER_FILTER,
      minzoom: 0,
      paint: {
        "fill-color": "#e9fbff",
        "fill-opacity": 0.92,
      },
    },
    {
      id: "__iceland_glacier_outline__",
      type: "line",
      source,
      "source-layer": "landcover",
      filter: GLACIER_FILTER,
      minzoom: 0,
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-color": "#7ddff0",
        "line-opacity": 0.95,
        "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.45, 7, 0.8, 10, 1.25],
      },
    },
  ];

  const firstSymbol = layers.findIndex((layer) => layer.type === "symbol");
  if (firstSymbol === -1) return [...layers, ...glacierLayers];
  return [
    ...layers.slice(0, firstSymbol),
    ...glacierLayers,
    ...layers.slice(firstSymbol),
  ];
};

// Patch every text-field in the style to use Icelandic names.
// labelsOnly=true draws a transparent symbol-only overlay for raster basemaps.
const patchStyle = (raw, labelsOnly = false, labelTheme = "light") => {
  const theme = LABEL_THEMES[labelTheme] ?? LABEL_THEMES.light;
  let layers = raw.layers
    .filter(l => labelsOnly || !HIDDEN_ROADMAP_LAYERS.has(l.id))
    .filter(l => !labelsOnly || (l.type === "symbol" && l.layout?.["text-field"]))
    .map(l => {
      if (!l.layout?.["text-field"]) return l;
      const layer = {
        ...l,
        layout: {
          ...l.layout,
          visibility: "visible",
          "text-field": IS_NAME_EXPR,
          "text-font": normalizeTextFont(l.layout["text-font"]),
        },
      };
      if (labelsOnly) {
        layer.paint = {
          ...(l.paint ?? {}),
          "text-color": theme.textColor,
          "text-halo-color": theme.haloColor,
          "text-halo-width": theme.haloWidth,
          "text-opacity": 1,
        };
      } else if (l.paint) {
        layer.paint = l.paint;
      }
      return layer;
    });
  if (labelsOnly) {
    // Explicit transparent background so the GL canvas doesn't paint over the raster tiles
    layers = [
      { id: "__transparent_bg__", type: "background", paint: { "background-color": "rgba(0,0,0,0)" } },
      ...layers,
    ];
  } else {
    layers = insertGlacierLayers(raw, layers);
  }
  return { ...raw, layers };
};

const buildRasterStyleWithLabels = (rasterStyle, rawOpenFreeMapStyle, labelTheme = "light") => {
  const labelStyle = patchStyle(rawOpenFreeMapStyle, true, labelTheme);
  return {
    ...labelStyle,
    sources: {
      ...rasterStyle.sources,
      ...labelStyle.sources,
    },
    layers: [
      ...rasterStyle.layers,
      ...labelStyle.layers,
    ],
  };
};

const setupGlLayer = (gl, map, { layerId, zIndex = "200", onReady, withFullscreen = false }) => {
  const mlMap = gl.getMaplibreMap();
  mlMap.scrollZoom.disable();
  mlMap.dragPan.disable();
  mlMap.dragRotate.disable();
  mlMap.keyboard.disable();
  mlMap.doubleClickZoom.disable();
  mlMap.touchZoomRotate.disable();
  mlMap.boxZoom.disable();

  mlMap.getCanvas().style.pointerEvents = "none";
  const glContainer = gl.getContainer?.() ?? mlMap.getContainer();
  if (glContainer) {
    glContainer.style.zIndex = zIndex;
    glContainer.style.pointerEvents = "none";
    if (layerId) glContainer.dataset.maplibreLayerId = layerId;
  }

  const initResize1 = setTimeout(() => mlMap.resize(), 100);
  const initResize2 = setTimeout(() => mlMap.resize(), 500);

  let resizeTimer = null;
  const handleResize = () => {
    mlMap.resize();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => mlMap.resize(), 300);
  };
  map.on("resize", handleResize);

  let handleFullscreen = null;
  if (withFullscreen) {
    handleFullscreen = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { map.invalidateSize(); mlMap.resize(); }, 300);
    };
    document.addEventListener("fullscreenchange", handleFullscreen);
    document.addEventListener("webkitfullscreenchange", handleFullscreen);
  }

  let readyTimer = null;
  if (onReady) {
    readyTimer = setTimeout(() => onReady(), 8000);
    mlMap.once("load", () => { clearTimeout(readyTimer); onReady(); });
  }

  return () => {
    clearTimeout(readyTimer);
    clearTimeout(resizeTimer);
    clearTimeout(initResize1);
    clearTimeout(initResize2);
    map.off("resize", handleResize);
    if (handleFullscreen) {
      document.removeEventListener("fullscreenchange", handleFullscreen);
      document.removeEventListener("webkitfullscreenchange", handleFullscreen);
    }
  };
};

const ignoreCleanupError = () => undefined;

const removeAttribution = (map, attribution) => {
  if (!attribution) return;
  try {
    map.attributionControl?.removeAttribution(attribution);
  } catch {
    ignoreCleanupError();
  }
};

const removeMatchingAttributions = (map, matcher) => {
  const attributions = map.attributionControl?._attributions;
  if (!attributions) return;
  Object.keys(attributions)
    .filter(matcher)
    .forEach((attribution) => {
      while (attributions[attribution] > 0) {
        removeAttribution(map, attribution);
      }
    });
};

const removeVerboseProviderAttributions = (map, keep = new Set()) => {
  removeMatchingAttributions(map, (attribution) => {
    if (keep.has(attribution)) return false;
    const text = attribution.toLowerCase();
    return (
      text.includes("openfreemap") ||
      text.includes("openmaptiles") ||
      text.includes("openstreetmap") ||
      text.includes("carto") ||
      text.includes("esri") ||
      text.includes("maxar") ||
      text.includes("earthstar") ||
      text.includes("icelandic meteorological") ||
      text.includes("natural science institute") ||
      text.includes("faults/fissures") ||
      text.includes("egdi") ||
      text.includes("isor")
    );
  });
};

const useMobileAttribution = () => {
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

  return isMobile;
};

const CompactAttribution = ({ mapType, showFaults }) => {
  const map = useMap();
  const isMobile = useMobileAttribution();

  useEffect(() => {
    const control = map.attributionControl;
    if (!control) return undefined;

    removeVerboseProviderAttributions(map);
    const attributions = isMobile ? MOBILE_ATTRIBUTIONS : COMPACT_ATTRIBUTIONS;
    const parts = [attributions[mapType] ?? attributions.roadmap];
    if (showFaults) parts.push(isMobile ? MOBILE_FAULTS_ATTRIBUTION : FAULTS_ATTRIBUTION);
    const compact = parts.join(" | ");
    control.addAttribution(compact);
    const keep = new Set([compact]);
    const cleanupTimers = [100, 500, 1200].map((delay) =>
      window.setTimeout(() => removeVerboseProviderAttributions(map, keep), delay)
    );

    return () => {
      cleanupTimers.forEach(window.clearTimeout);
      removeAttribution(map, compact);
    };
  }, [map, mapType, showFaults, isMobile]);

  return null;
};

const removeManagedGlContainers = (map, layerId) => {
  if (!layerId) return;
  const container = map.getContainer?.();
  if (!container) return;
  container
    .querySelectorAll(`.leaflet-gl-layer[data-maplibre-layer-id="${layerId}"]`)
    .forEach((node) => {
      try {
        node.remove();
      } catch {
        ignoreCleanupError();
      }
    });
};

const collectMaplibreAttributions = (gl) => {
  const values = new Set();
  try {
    const attribution = gl.getAttribution?.();
    if (attribution) values.add(attribution);
  } catch {
    ignoreCleanupError();
  }

  try {
    const mlMap = gl.getMaplibreMap?.();
    const sources = mlMap?.getStyle?.()?.sources ?? {};
    Object.keys(sources).forEach((sourceId) => {
      const attribution = mlMap.getSource?.(sourceId)?.attribution;
      if (typeof attribution === "string" && attribution.trim()) {
        values.add(attribution.trim());
      }
    });
  } catch {
    ignoreCleanupError();
  }

  return values;
};

const removeMaplibreLayer = (map, gl, layerId) => {
  if (!gl) return;
  const attributions = collectMaplibreAttributions(gl);
  const container = gl.getContainer?.();
  const managedLayerId = layerId ?? container?.dataset?.maplibreLayerId;

  try {
    if (map.hasLayer(gl)) map.removeLayer(gl);
  } catch {
    try {
      gl.getMaplibreMap?.()?.remove();
    } catch {
      ignoreCleanupError();
    }
  } finally {
    if (container?.parentNode) {
      try {
        container.parentNode.removeChild(container);
      } catch {
        ignoreCleanupError();
      }
    }
  }

  removeManagedGlContainers(map, managedLayerId);
  attributions.forEach((attribution) => removeAttribution(map, attribution));
  removeMatchingAttributions(map, (attribution) =>
    attribution.toLowerCase().includes("openfreemap") ||
    attribution.toLowerCase().includes("openmaptiles") ||
    attribution.toLowerCase().includes("openstreetmap")
  );
};

const createMaplibreLayer = (map, options) => {
  let gl = null;
  try {
    gl = L.maplibreGL(options).addTo(map);
    return gl;
  } catch (error) {
    removeMaplibreLayer(map, gl, options?.layerId);
    console.warn("MapLibre GL failed; using raster fallback where available.", error);
    return null;
  }
};

const removePane = (map, paneName) => {
  const pane = map.getPane(paneName);
  if (!pane) return;
  try {
    pane.remove();
  } catch {
    ignoreCleanupError();
  }
  if (map._panes) delete map._panes[paneName];
  if (map._paneRenderers) delete map._paneRenderers[paneName];
};

const MaplibreLabelOverlay = ({ paneName, paneZIndex, labelTheme = "light" }) => {
  const map = useMap();
  const cleanupRef = useRef(() => {});

  useEffect(() => {
    let dead = false;
    let gl = null;
    const pane = map.getPane(paneName) ?? map.createPane(paneName);
    pane.style.zIndex = String(paneZIndex);
    pane.style.pointerEvents = "none";

    fetchRawStyle()
      .then(raw => {
        if (dead) return;
        const layerId = `${paneName}-openfreemap-labels`;
        gl = createMaplibreLayer(map, {
          pane: paneName,
          layerId,
          style: patchStyle(raw, true, labelTheme),
          attribution: "",
          fadeDuration: 0,
          collectResourceTiming: false,
          trackResize: false,
          pixelRatio: 1,
          maxTileCacheSize: 20,
          antialias: false,
        });

        if (!gl) {
          removePane(map, paneName);
          return;
        }

        const teardown = setupGlLayer(gl, map, { layerId, zIndex: String(paneZIndex) });
        cleanupRef.current = () => {
          teardown();
          removeMaplibreLayer(map, gl, layerId);
          removePane(map, paneName);
        };
      })
      .catch(() => removePane(map, paneName));

    return () => {
      dead = true;
      cleanupRef.current();
      cleanupRef.current = () => {};
      if (!gl) removePane(map, paneName);
    };
  }, [map, paneName, paneZIndex, labelTheme]);

  return null;
};

const HeatmapTileLayers = ({ onReady }) => {
  const map = useMap();

  useEffect(() => {
    const baseLayer = L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png",
      {
        attribution: "",
        maxZoom: 19,
        maxNativeZoom: 18,
        subdomains: "abcd",
        zIndex: 1,
        ...TILE_PROPS,
      }
    );

    if (onReady) baseLayer.once("load", onReady);
    baseLayer.addTo(map);

    return () => {
      if (onReady) baseLayer.off("load", onReady);
      try {
        if (map.hasLayer(baseLayer)) map.removeLayer(baseLayer);
      } catch {
        ignoreCleanupError();
      }
    };
  }, [map, onReady]);

  return null;
};

const TileLayerManager = ({ mapType, onReady }) => {
  if (mapType === "roadmap") {
    const layer = TILE_LAYERS.roadmap;
    return (
      <TileLayer
        key={mapType}
        url={layer.url}
        attribution=""
        maxZoom={layer.maxZoom}
        maxNativeZoom={layer.maxNativeZoom}
        subdomains={layer.subdomains}
        zIndex={1}
        eventHandlers={{ load: onReady }}
        {...TILE_PROPS}
      />
    );
  }
  if (mapType === "heatmap") {
    return (
      <>
        <HeatmapTileLayers onReady={onReady} />
        <MaplibreLabelOverlay paneName="heatmap-labels" paneZIndex={550} labelTheme="dark" />
      </>
    );
  }
  if (mapType === "satellite" || mapType === "terrain") {
    const layer = TILE_LAYERS[mapType];
    return (
      <>
        <TileLayer
          key={mapType}
          url={layer.url}
          attribution=""
          maxZoom={layer.maxZoom}
          maxNativeZoom={layer.maxNativeZoom}
          subdomains={layer.subdomains ?? "abc"}
          zIndex={1}
          eventHandlers={{ load: onReady }}
          {...TILE_PROPS}
        />
        <MaplibreLabelOverlay
          paneName={`${mapType}-labels`}
          paneZIndex={380}
          labelTheme={mapType === "satellite" ? "dark" : "light"}
        />
      </>
    );
  }

  const layer = TILE_LAYERS[mapType];
  return (
    <TileLayer
      key={mapType}
      url={layer.url}
      attribution=""
      maxZoom={layer.maxZoom}
      maxNativeZoom={layer.maxNativeZoom}
      eventHandlers={{ load: onReady }}
      {...TILE_PROPS}
    />
  );
};

// Place Iceland in the usable map area, accounting for the left control panel.
const FitIcelandOnReady = () => {
  const map = useMap();
  const didFit = useRef(false);
  useEffect(() => {
    if (didFit.current) return;
    didFit.current = true;
    const view = getDefaultLeafletView();
    map.setView(view.center, view.zoom, { animate: false });
  }, [map]);
  return null;
};

// Resets the map view to the default Iceland bounds when `trigger` increments.
const MapViewResetter = ({ trigger }) => {
  const map = useMap();
  const prev = useRef(trigger);
  useEffect(() => {
    if (trigger === prev.current) return;
    prev.current = trigger;
    const view = getDefaultLeafletView();
    map.setView(view.center, view.zoom, { animate: true });
  }, [trigger, map]);
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

const MapUiResizeHandler = () => {
  const map = useMap();
  useEffect(() => {
    const handleResize = () => {
      map.invalidateSize();
      setTimeout(() => map.invalidateSize(), 280);
    };
    window.addEventListener('quake-map-ui-resize', handleResize);
    return () => window.removeEventListener('quake-map-ui-resize', handleResize);
  }, [map]);
  return null;
};

const MapClickHandler = ({ onClick }) => {
  useMapEvents({ click: onClick });
  return null;
};

const GlacierLabelsOverlay = ({ visible }) => {
  const map = useMap();
  const labelsRef = useRef([]);

  useEffect(() => {
    const pane = map.getPane("glacier-labels") ?? map.createPane("glacier-labels");
    pane.style.zIndex = "360";
    pane.style.pointerEvents = "none";

    labelsRef.current = GLACIER_LABELS.map(({ name, lat, lng, minZoom, priority }) => ({
      name,
      lat,
      lng,
      minZoom,
      priority,
      marker: L.marker([lat, lng], {
        pane: "glacier-labels",
        icon: glacierLabelIcon(name, map.getZoom()),
        interactive: false,
      }),
    }));

    return () => {
      labelsRef.current.forEach(({ marker }) => {
        try {
          map.removeLayer(marker);
        } catch {
          ignoreCleanupError();
        }
      });
      labelsRef.current = [];
      removePane(map, "glacier-labels");
    };
  }, [map]);

  useEffect(() => {
    const updateLabels = () => {
      const zoom = map.getZoom();
      const placed = [];
      const labels = [...labelsRef.current].sort((a, b) => a.priority - b.priority);

      labels.forEach((label) => {
        const { name, marker, minZoom } = label;
        const box = glacierLabelBounds(map, label, zoom);
        const collides = placed.some((placedBox) => overlaps(box, placedBox));
        const shouldShow = visible && zoom >= minZoom && !collides;
        const isShown = map.hasLayer(marker);
        marker.setIcon(glacierLabelIcon(name, zoom));
        if (shouldShow && !isShown) marker.addTo(map);
        if (!shouldShow && isShown) map.removeLayer(marker);
        if (shouldShow) placed.push(box);
      });
    };

    updateLabels();
    map.on("zoomend", updateLabels);
    map.on("moveend", updateLabels);
    return () => {
      map.off("zoomend", updateLabels);
      map.off("moveend", updateLabels);
    };
  }, [map, visible]);

  return null;
};

// Leaflet ignores right-click drag (button=2) entirely. This component:
// 1. Intercepts right-mousedown and converts the drag into map panning via panBy.
// 2. Suppresses the context menu if the mouse moved (drag), lets it show if not (simple click).
const RightClickHandler = () => {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    let isDragging = false;
    let didMove = false;
    let lastX = 0;
    let lastY = 0;

    const onMouseDown = (e) => {
      if (e.button !== 2) return;
      isDragging = true;
      didMove = false;
      lastX = e.clientX;
      lastY = e.clientY;
    };

    const onMouseMove = (e) => {
      if (!isDragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        didMove = true;
        map.panBy([-dx, -dy], { animate: false });
      }
      lastX = e.clientX;
      lastY = e.clientY;
    };

    const onMouseUp = (e) => {
      if (e.button !== 2) return;
      isDragging = false;
    };

    // Capture-phase: runs before Leaflet's bubble-phase handler that calls preventDefault().
    // If it was a drag, suppress entirely. If a simple right-click, let native menu appear.
    const onContextMenu = (e) => {
      if (didMove) {
        e.preventDefault();
        e.stopPropagation();
        didMove = false;
      } else {
        e.stopPropagation(); // block Leaflet's preventDefault so native menu shows
      }
    };

    container.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    container.addEventListener('contextmenu', onContextMenu, true);

    return () => {
      container.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      container.removeEventListener('contextmenu', onContextMenu, true);
    };
  }, [map]);
  return null;
};

const GRID_ZOOM_LEVELS = [
  { maxZoom: 5, lngSpacing: 1, labelDecimals: 1 },
  { maxZoom: 6, lngSpacing: 1, labelDecimals: 1 },
  { maxZoom: 7, lngSpacing: 0.5, labelDecimals: 2 },
  { maxZoom: 8, lngSpacing: 0.2, labelDecimals: 2 },
  { maxZoom: 9, lngSpacing: 0.1, labelDecimals: 2 },
  { maxZoom: 10, lngSpacing: 0.05, labelDecimals: 3 },
  { maxZoom: 11, lngSpacing: 0.02, labelDecimals: 3 },
  { maxZoom: 12, lngSpacing: 0.01, labelDecimals: 3 },
  { maxZoom: 13, lngSpacing: 0.005, labelDecimals: 4 },
  { maxZoom: Infinity, lngSpacing: 0.002, labelDecimals: 4 },
];

const getGridConfig = (zoom) => {
  const config = GRID_ZOOM_LEVELS.find(({ maxZoom }) => zoom <= maxZoom);
  return {
    lngGridSpacing: config.lngSpacing,
    labelDecimals: config.labelDecimals,
  };
};

const GridOverlay = ({ show, isDarkMode, mapType, emphasizeLabels = false }) => {
  const map = useMap();
  const gridRef = useRef([]);
  const darkLike = isDarkMode || mapType === "satellite" || mapType === "heatmap";

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

    const { lngGridSpacing, labelDecimals } = getGridConfig(zoom);
    const subLngGridSpacing = lngGridSpacing / 2;

    const latGridSpacing = lngGridSpacing / 2;
    const subLatGridSpacing = latGridSpacing / 2;
    const normalizeGridValue = (value, step) => Number((Math.round(value / step) * step).toFixed(6));
    const isOnStep = (value, step) => Math.abs(value / step - Math.round(value / step)) < 0.001;

    const mainColor  = darkLike ? "#ddd8cc" : "#666666";
    const subColor   = darkLike ? "#bbb5aa" : "#888888";
    const lblColor   = darkLike ? "#ffffff" : "#333333";
    const labelSize = emphasizeLabels ? "11px" : "10px";
    const labelWeight = emphasizeLabels ? "700" : "400";

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
    const addLabel = (lat, lng, text, color, size, fontWeight = "400", iconAnchor = [0, 13]) => {
      gridRef.current.push(
        L.marker([lat, lng], {
          icon: L.divIcon({
            className: "grid-label-icon",
            html: `<span style="color:${color};font-size:${size};font-weight:${fontWeight};white-space:nowrap;pointer-events:none;">${text}</span>`,
            iconSize: [80, 16],
            iconAnchor,
          }),
          interactive: false,
          zIndexOffset: -9000,
        }).addTo(map)
      );
    };

    const startLat = Math.floor(extS / latGridSpacing) * latGridSpacing;
    const endLat   = Math.ceil(extN / latGridSpacing) * latGridSpacing;
    const startLng = Math.floor(extW / lngGridSpacing) * lngGridSpacing;
    const endLng   = Math.ceil(extE / lngGridSpacing) * lngGridSpacing;

    const mapSize = map.getSize();
    const center = map.getCenter();
    const isMobileGrid = mapSize.x <= 767;
    const LAT_LABEL_X = isMobileGrid ? mapSize.x - 52 : 245;
    const LAT_LABEL_Y_OFFSET = -6;
    const LNG_LABEL_Y = mapSize.y - 34;
    const MIN_LNG_LABEL_GAP = 72;
    const LNG_LABEL_MIN_X = isMobileGrid ? 18 : 210;
    const LNG_LABEL_MAX_X = mapSize.x - 40;
    let lastLngLabelX = -Infinity;

    const labelLatLngFromPoint = (x, y) => map.containerPointToLatLng([x, y]);

    for (let lat = startLat; lat <= endLat; lat = normalizeGridValue(lat + latGridSpacing, latGridSpacing)) {
      if (lat < -85 || lat > 85) continue;
      addLine([[lat, extW], [lat, extE]], mainColor, 0.5, 0.5);

      const labelY = map.latLngToContainerPoint([lat, center.lng]).y + LAT_LABEL_Y_OFFSET;
      if (labelY < 24 || labelY > mapSize.y - 38) continue;
      const labelPoint = labelLatLngFromPoint(LAT_LABEL_X, labelY);
      addLabel(labelPoint.lat, labelPoint.lng,
        `${lat.toFixed(labelDecimals)}\u00b0${lat > 0 ? "N" : lat < 0 ? "S" : ""}`,
        lblColor, labelSize, labelWeight, [0, 13]);
    }
    for (let lng = startLng; lng <= endLng; lng = normalizeGridValue(lng + lngGridSpacing, lngGridSpacing)) {
      addLine([[extS, lng], [extN, lng]], mainColor, 0.5, 0.5);

      const labelX = map.latLngToContainerPoint([center.lat, lng]).x;
      if (labelX < LNG_LABEL_MIN_X || labelX > LNG_LABEL_MAX_X) continue;
      if (labelX - lastLngLabelX < MIN_LNG_LABEL_GAP) continue;
      lastLngLabelX = labelX;
      const labelPoint = labelLatLngFromPoint(labelX, LNG_LABEL_Y);
      addLabel(labelPoint.lat, labelPoint.lng,
        `${lng.toFixed(labelDecimals)}\u00b0${lng > 0 ? "E" : lng < 0 ? "W" : ""}`,
        lblColor, labelSize, labelWeight, [20, 13]);
    }
    const sLat = Math.floor(extS / subLatGridSpacing) * subLatGridSpacing;
    const eLat = Math.ceil(extN / subLatGridSpacing) * subLatGridSpacing;
    for (let lat = sLat; lat <= eLat; lat = normalizeGridValue(lat + subLatGridSpacing, subLatGridSpacing)) {
      if (lat < -85 || lat > 85) continue;
      if (isOnStep(lat, latGridSpacing)) continue;
      addLine([[lat, extW], [lat, extE]], subColor, 0.5, 0.5);
    }

    if (subLngGridSpacing !== null) {
      const sLng = Math.floor(extW / subLngGridSpacing) * subLngGridSpacing;
      const eLng = Math.ceil(extE / subLngGridSpacing) * subLngGridSpacing;
      for (let lng = sLng; lng <= eLng; lng = normalizeGridValue(lng + subLngGridSpacing, subLngGridSpacing)) {
        if (isOnStep(lng, lngGridSpacing)) continue;
        addLine([[extS, lng], [extN, lng]], subColor, 0.5, 0.5);
      }
    }
  }, [map, show, darkLike, emphasizeLabels]);

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

const getMarkerRadius = (zoom, isSelected) => {
  const base =
    zoom <= 5  ? 2.5 :
    zoom <= 6  ? 2.5 :
    zoom <= 7  ? 3 :
    zoom <= 8  ? 3.5 :
    zoom <= 9  ? 3.5 :
    zoom <= 10 ? 4 :
    zoom <= 11 ? 4.5 : 5;
  return isSelected ? base + 2 : base;
};

// Color ramp: transparent → dark blue → blue → teal → amber → orange → deep red
// Equal-weight stops eliminate the wide yellow band; reads cleanly on a dark basemap.
const HEAT_GRADIENT = {
  0.00: 'transparent',
  0.15: '#1e1b4b',   // dark indigo-blue (sparse — first visible)
  0.30: '#2563eb',   // medium blue
  0.50: '#14b8a6',   // teal
  0.65: '#f59e0b',   // amber
  0.80: '#f97316',   // orange
  1.00: '#dc2626',   // deep red (peak density)
};

const getHeatOptions = (zoom) => {
  if (zoom <= 6) return { radius: 34, blur: 26, minOpacity: 0.08 };
  if (zoom <= 8) return { radius: 24, blur: 18, minOpacity: 0.05 };
  return { radius: 16, blur: 12, minOpacity: 0.03 };
};

const getHeatZoomBand = (zoom) => {
  if (zoom <= 6) return "regional";
  if (zoom <= 8) return "medium";
  return "local";
};

const getHeatWeight = (magnitude) => {
  if (magnitude >= 5.0) return 0.45;
  if (magnitude >= 4.0) return 0.30;
  return 0.20;
};

const HEATMAP_PANE = "heatmap-pane";

const HeatmapLayer = ({ earthquakes }) => {
  const map = useMap();
  const heatRef = useRef(null);
  const [pluginReady, setPluginReady] = useState(false);

  // Load leaflet.heat once — must set window.L before the dynamic import
  useEffect(() => {
    window.L = L;
    import("leaflet.heat").then(() => setPluginReady(true));
  }, []);

  useEffect(() => {
    const pane = map.getPane(HEATMAP_PANE) ?? map.createPane(HEATMAP_PANE);
    pane.style.zIndex = "620";
    pane.style.pointerEvents = "none";
  }, [map]);

  const rebuild = useCallback(() => {
    if (!pluginReady) return;
    if (heatRef.current) { map.removeLayer(heatRef.current); heatRef.current = null; }
    if (earthquakes.length === 0) return;

    const zoom = map.getZoom();

    const points = earthquakes.map(q => {
      const lat = parseFloat(q.Latitude);
      const lng = parseFloat(q.Longitude);
      const mag = parseFloat(q.Mw_mean);
      if (isNaN(lat) || isNaN(lng) || isNaN(mag)) return null;
      // Density-first weighting: isolated quakes stay subtle, while nearby
      // events accumulate into clear clusters.
      const wt = getHeatWeight(mag);
      return [lat, lng, wt];
    }).filter(Boolean);

    heatRef.current = L.heatLayer(points, {
      pane: HEATMAP_PANE,
      ...getHeatOptions(zoom),
      maxZoom: 6,
      max: 2.5,
      gradient: HEAT_GRADIENT,
    }).addTo(map);

    // The heat canvas is treated as an image by the browser, so right-click
    // shows "Save image as" instead of the normal page menu.  Disabling
    // pointer-events lets clicks fall through to the map container div,
    // which shows the standard context menu.  Pan/zoom is unaffected
    // because Leaflet listens on the container, not on overlay canvases.
    if (heatRef.current._canvas) {
      heatRef.current._canvas.style.pointerEvents = "none";
      heatRef.current._canvas.style.zIndex = "620";
    }
  }, [map, earthquakes, pluginReady]);

  useEffect(() => {
    rebuild();
    return () => {
      if (heatRef.current) { map.removeLayer(heatRef.current); heatRef.current = null; }
    };
  }, [map, rebuild]);

  // Re-draw only when crossing heat bands; panning and within-band zooms do
  // not need option changes and should not amplify the heatmap.
  useEffect(() => {
    let currentBand = getHeatZoomBand(map.getZoom());
    const rebuildOnBandChange = () => {
      const nextBand = getHeatZoomBand(map.getZoom());
      if (nextBand === currentBand) return;
      currentBand = nextBand;
      rebuild();
    };
    map.on("zoomend", rebuildOnBandChange);
    return () => { map.off("zoomend", rebuildOnBandChange); };
  }, [map, rebuild]);

  return null;
};

const HeatmapLegend = () => {
  const t = useT();
  return (
    <div className="heatmap-legend">
      <div className="heatmap-legend-title">{t('heatmap_density')}</div>
      <div className="heatmap-legend-bar" />
      <div className="heatmap-legend-labels">
        <span>{t('heatmap_low')}</span>
        <span>{t('heatmap_high')}</span>
      </div>
    </div>
  );
};

const ML_HIKE_WFS_URL = "https://maps.europe-geology.eu/wfs/";
const ML_ICELAND_BBOX = "-24.8,63.0,-13.0,66.7";
let mapLibreFaultsGeojson = null;
let mapLibreFaultsPromise = null;

const fetchMapLibreFaults = () => {
  if (mapLibreFaultsGeojson) return Promise.resolve(mapLibreFaultsGeojson);
  if (!mapLibreFaultsPromise) {
    const params = new URLSearchParams({
      service: "WFS",
      version: "1.0.0",
      request: "GetFeature",
      typename: "hike_detail_layer",
      outputformat: "geojson",
      bbox: ML_ICELAND_BBOX,
    });
    mapLibreFaultsPromise = fetch(`${ML_HIKE_WFS_URL}?${params.toString()}`)
      .then((response) => {
        if (!response.ok) throw new Error(`Faults WFS request failed: ${response.status}`);
        return response.json();
      })
      .then((geojson) => {
        mapLibreFaultsGeojson = {
          ...geojson,
          features: (geojson?.features ?? []).filter((feature) => {
            const props = feature?.properties ?? {};
            return props.country_cd === "IS" && props.observ_meth !== "sonar survey";
          }),
        };
        return mapLibreFaultsGeojson;
      })
      .catch((error) => {
        mapLibreFaultsPromise = null;
        throw error;
      });
  }
  return mapLibreFaultsPromise;
};

const isSameEarthquake = (a, b) =>
  !!a && !!b &&
  a["Date-time"] === b["Date-time"] &&
  a.Latitude === b.Latitude &&
  a.Longitude === b.Longitude;

const buildGridGeojson = (map) => {
  if (!map) return { type: "FeatureCollection", features: [] };
  const bounds = map.getBounds();
  const zoom = map.getZoom();
  const west = bounds.getWest();
  const east = bounds.getEast();
  const south = bounds.getSouth();
  const north = bounds.getNorth();
  const { lngGridSpacing, labelDecimals } = getGridConfig(zoom);
  const latGridSpacing = lngGridSpacing / 2;
  const normalize = (value, step) => Number((Math.round(value / step) * step).toFixed(6));
  const features = [];

  const startLat = Math.floor(south / latGridSpacing) * latGridSpacing;
  const endLat = Math.ceil(north / latGridSpacing) * latGridSpacing;
  const startLng = Math.floor(west / lngGridSpacing) * lngGridSpacing;
  const endLng = Math.ceil(east / lngGridSpacing) * lngGridSpacing;
  const canvas = map.getCanvas();
  const mapWidth = canvas.clientWidth;
  const mapHeight = canvas.clientHeight;
  const isMobileGrid = mapWidth <= 767;
  const latLabelX = isMobileGrid ? mapWidth - 52 : 245;
  const latLabelYOffset = -6;
  const lngLabelY = mapHeight - 34;
  const minLngLabelGap = 72;
  const lngLabelMinX = isMobileGrid ? 18 : 210;
  const lngLabelMaxX = mapWidth - 40;
  let lastLngLabelX = -Infinity;

  for (let lat = startLat; lat <= endLat; lat = normalize(lat + latGridSpacing, latGridSpacing)) {
    if (lat < -85 || lat > 85) continue;
    features.push({
      type: "Feature",
      properties: { kind: "line" },
      geometry: { type: "LineString", coordinates: [[west - 2, lat], [east + 2, lat]] },
    });

    const labelY = map.project([map.getCenter().lng, lat]).y + latLabelYOffset;
    if (labelY < 24 || labelY > mapHeight - 38) continue;
    const labelPoint = map.unproject([latLabelX, labelY]);
    features.push({
      type: "Feature",
      properties: {
        kind: "label",
        axis: "latitude",
        label: `${lat.toFixed(labelDecimals)}\u00b0${lat > 0 ? "N" : lat < 0 ? "S" : ""}`,
      },
      geometry: { type: "Point", coordinates: [labelPoint.lng, labelPoint.lat] },
    });
  }

  for (let lng = startLng; lng <= endLng; lng = normalize(lng + lngGridSpacing, lngGridSpacing)) {
    features.push({
      type: "Feature",
      properties: { kind: "line" },
      geometry: { type: "LineString", coordinates: [[lng, south - 1], [lng, north + 1]] },
    });

    const labelX = map.project([lng, map.getCenter().lat]).x;
    if (labelX < lngLabelMinX || labelX > lngLabelMaxX) continue;
    if (labelX - lastLngLabelX < minLngLabelGap) continue;
    lastLngLabelX = labelX;
    const labelPoint = map.unproject([labelX, lngLabelY]);
    features.push({
      type: "Feature",
      properties: {
        kind: "label",
        axis: "longitude",
        label: `${lng.toFixed(labelDecimals)}\u00b0${lng > 0 ? "E" : lng < 0 ? "W" : ""}`,
      },
      geometry: { type: "Point", coordinates: [labelPoint.lng, labelPoint.lat] },
    });
  }
  return { type: "FeatureCollection", features };
};
const MapLibreVolcanoMarkers = ({ volcanoes, selectedVolcano, onSelect }) => (
  <>
    {volcanoes.map((volcano, index) => {
      const lat = Number(volcano.latitude);
      const lng = Number(volcano.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      const isSelected = selectedVolcano?.name === volcano.name;
      return (
        <Marker
          key={`volcano-${index}`}
          longitude={lng}
          latitude={lat}
          anchor="center"
          onClick={(event) => {
            event.originalEvent.stopPropagation();
            onSelect(volcano);
          }}
        >
          <div
            className={`maplibre-volcano-marker${isSelected ? " is-selected" : ""}`}
            title={volcano.name}
          />
        </Marker>
      );
    })}
  </>
);

const MapLibreFaultsLegendControl = () => {
  useControl(() => {
    let container = null;
    return {
      onAdd: () => {
        container = document.createElement("div");
        container.className = "maplibregl-ctrl faults-legend-control maplibre-faults-legend";
        container.innerHTML = `
          <div class="tectonic-legend">
            <div class="tectonic-legend__title">Faults / Fissures</div>
            <div class="tectonic-legend__row"><span class="tec-swatch tec-swatch--fault-line"></span><span>Fault</span></div>
            <a class="tectonic-legend__source" href="${HIKE_METADATA_URL}" target="_blank" rel="noreferrer">Source: EGDI/HIKE, ISOR</a>
          </div>
        `;
        return container;
      },
      onRemove: () => {
        container?.remove();
        container = null;
      },
    };
  }, { position: "bottom-right" });
  return null;
};
const MapLibreFaultsOverlay = ({ show }) => {
  const [geojson, setGeojson] = useState(null);

  useEffect(() => {
    if (!show) return undefined;
    let dead = false;
    fetchMapLibreFaults()
      .then((data) => {
        if (!dead) setGeojson(data);
      })
      .catch((error) => console.error(error));
    return () => { dead = true; };
  }, [show]);

  if (!show || !geojson) return null;

  return (
    <>
      <Source id="faults" type="geojson" data={geojson}>
        <Layer
          id="faults-lines"
          type="line"
          paint={{
            "line-color": "#8f1f1f",
            "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.8, 8, 1.4, 12, 2.2],
            "line-opacity": 0.92,
          }}
          layout={{ "line-cap": "round", "line-join": "round" }}
        />
      </Source>
    </>
  );
};

const MapLibreEarthquakeMap = ({
  earthquakes,
  volcanoes,
  maxMagnitude,
  mapType,
  showGrid,
  showFaults,
  colorOwner,
  isDarkMode,
  selectedEarthquake,
  selectedVolcano,
  onMarkerClick,
  onMapClick,
  onVolcanoClick,
  onReady,
  resetViewTrigger,
}) => {
  const mapRef = useRef(null);
  const deckOverlayRef = useRef(null);
  const deckOverlayAttachedRef = useRef(false);
  const deckOverlayMapRef = useRef(null);
  const clickedEarthquakeRef = useRef(false);
  const hoveringEarthquakeRef = useRef(false);
  const [viewZoom, setViewZoom] = useState(ICELAND_VIEW.zoom);
  const [gridGeojson, setGridGeojson] = useState({ type: "FeatureCollection", features: [] });
  const [styledMapStyle, setStyledMapStyle] = useState(null);
  const initialViewState = useMemo(() => getDefaultMapLibreView(), []);

  if (!deckOverlayRef.current) {
    deckOverlayRef.current = new MapboxOverlay({
      layers: [],
      getCursor: ({ isHovering }) => (isHovering ? "pointer" : "grab"),
    });
  }

  const attachDeckOverlay = useCallback((map) => {
    const overlay = deckOverlayRef.current;
    if (!map || !overlay) return;
    if (deckOverlayAttachedRef.current && deckOverlayMapRef.current === map) return;

    if (deckOverlayAttachedRef.current && deckOverlayMapRef.current) {
      try {
        deckOverlayMapRef.current.removeControl(overlay);
      } catch {
        ignoreCleanupError();
      }
    }

    map.addControl(overlay);
    deckOverlayMapRef.current = map;
    deckOverlayAttachedRef.current = true;
  }, []);

  const applyDefaultView = useCallback((map, duration = 0) => {
    if (!map) return;
    const view = getDefaultMapLibreView();
    const options = {
      center: [view.longitude, view.latitude],
      zoom: view.zoom,
      bearing: 0,
      pitch: 0,
    };
    if (duration > 0) {
      map.easeTo({ ...options, duration });
    } else {
      map.jumpTo(options);
    }
    setViewZoom(view.zoom);
  }, []);

  const deckData = useMemo(() => {
    const timelinePalette = mapType === "satellite" ? SATELLITE_TIMELINE_YEAR_STOPS : TIMELINE_YEAR_STOPS;
    return earthquakes
      .map((quake) => {
        const lat = Number(quake.Latitude);
        const lng = Number(quake.Longitude);
        const mag = Number(quake.Mw_mean) || 0;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        const color =
          colorOwner === "timeline"
            ? getTimelineColorForDate(quake["Date-time"], timelinePalette)
            : getMarkerColor(mag, maxMagnitude);
        return { quake, lat, lng, mag, color: colorStringToDeckRgba(color) };
      })
      .filter(Boolean)
      .sort((a, b) => a.mag - b.mag);
  }, [earthquakes, colorOwner, mapType, maxMagnitude]);

  useEffect(() => {
    const overlay = deckOverlayRef.current;
    if (!overlay) return;

    const hitLayer = new ScatterplotLayer({
      id: "earthquake-hit-targets",
      data: deckData,
      getPosition: d => [d.lng, d.lat],
      getFillColor: [0, 0, 0, 0],
      getRadius: d => getDeckMarkerRadius(viewZoom, isSameEarthquake(d.quake, selectedEarthquake)) * 3,
      radiusUnits: "pixels",
      pickable: true,
      opacity: 0,
      stroked: false,
      filled: true,
      radiusScale: 1,
      onClick: (info) => {
        if (!info.object) return;
        clickedEarthquakeRef.current = true;
        onMarkerClick(info.object.quake);
      },
      onHover: (info) => {
        const canvas = mapRef.current?.getMap()?.getCanvas();
        hoveringEarthquakeRef.current = !!info.object;
        if (canvas) canvas.style.cursor = info.object ? "pointer" : "";
      },
      updateTriggers: {
        getRadius: [viewZoom, selectedEarthquake],
      },
    });

    const dotLayer = new ScatterplotLayer({
      id: "earthquakes",
      data: deckData,
      getPosition: d => [d.lng, d.lat],
      getFillColor: d => d.color,
      getRadius: d => getDeckMarkerRadius(viewZoom, isSameEarthquake(d.quake, selectedEarthquake)),
      radiusUnits: "pixels",
      pickable: false,
      opacity: 0.88,
      stroked: true,
      filled: true,
      radiusScale: 1,
      getLineColor: d => isSameEarthquake(d.quake, selectedEarthquake) ? [255, 255, 255, 255] : [255, 255, 255, 0],
      getLineWidth: d => isSameEarthquake(d.quake, selectedEarthquake) ? 2 : 0,
      lineWidthUnits: "pixels",
      updateTriggers: {
        getFillColor: [deckData],
        getRadius: [viewZoom, selectedEarthquake],
        getLineColor: [selectedEarthquake],
        getLineWidth: [selectedEarthquake],
      },
    });

    overlay.setProps({ layers: [hitLayer, dotLayer] });
  }, [deckData, onMarkerClick, selectedEarthquake, viewZoom]);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    attachDeckOverlay(map);
  }, [attachDeckOverlay, mapType, styledMapStyle]);

  useEffect(() => () => {
    const currentMap = deckOverlayMapRef.current ?? mapRef.current?.getMap();
    const canvas = currentMap?.getCanvas();
    if (canvas) canvas.style.cursor = "";
    const overlay = deckOverlayRef.current;
    if (currentMap && overlay && deckOverlayAttachedRef.current) {
      currentMap.removeControl(overlay);
      deckOverlayAttachedRef.current = false;
      deckOverlayMapRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!resetViewTrigger) return;
    const map = mapRef.current?.getMap();
    applyDefaultView(map, 500);
  }, [applyDefaultView, resetViewTrigger]);

  const updateGrid = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map || !showGrid) return;
    setGridGeojson(buildGridGeojson(map));
  }, [showGrid]);

  useEffect(() => {
    if (!showGrid) {
      setGridGeojson({ type: "FeatureCollection", features: [] });
      return;
    }
    updateGrid();
  }, [showGrid, updateGrid]);

  useEffect(() => {
    onReady();
  }, [mapType, onReady]);

  useEffect(() => {
    let cancelled = false;
    if (mapType === "heatmap") {
      setStyledMapStyle(null);
      return undefined;
    }
    fetchRawStyle()
      .then((raw) => {
        if (cancelled) return;
        if (mapType === "roadmap") {
          setStyledMapStyle(patchStyle(raw));
          return;
        }
        const rasterStyle = MAPLIBRE_STYLES[mapType] ?? MAPLIBRE_STYLES.roadmap;
        const labelTheme = mapType === "satellite" ? "dark" : "light";
        setStyledMapStyle(buildRasterStyleWithLabels(rasterStyle, raw, labelTheme));
      })
      .catch(() => {
        if (!cancelled) setStyledMapStyle(null);
      });
    return () => {
      cancelled = true;
    };
  }, [mapType]);

  const handleMapLoad = useCallback((event) => {
    const map = event.target;
    attachDeckOverlay(map);
    applyDefaultView(map, 0);
    updateGrid();
    onReady();
  }, [applyDefaultView, attachDeckOverlay, onReady, updateGrid]);

  const handleMapClick = useCallback(() => {
    setTimeout(() => {
      if (clickedEarthquakeRef.current) {
        clickedEarthquakeRef.current = false;
        return;
      }
      onMapClick();
    }, 0);
  }, [onMapClick]);

  const activeMapStyle = styledMapStyle ?? (MAPLIBRE_STYLES[mapType] ?? MAPLIBRE_STYLES.roadmap);

  return (
    <MapLibreMap
      key={mapType}
      ref={mapRef}
      initialViewState={initialViewState}
      style={{ width: "100vw", height: "100vh" }}
      mapStyle={activeMapStyle}
      maxBounds={ICELAND_BOUNDS_LNG_LAT}
      minZoom={4}
      maxZoom={18}
      renderWorldCopies={false}
      attributionControl={true}
      onLoad={handleMapLoad}
      onMove={(event) => setViewZoom(event.viewState.zoom)}
      onMoveEnd={updateGrid}
      onZoomEnd={updateGrid}
      onClick={handleMapClick}
      cursor={hoveringEarthquakeRef.current ? "pointer" : "grab"}
    >
      <NavigationControl position="bottom-right" />
      {showFaults && <MapLibreFaultsLegendControl />}
      <MapLibreScaleControl position="bottom-right" />
      {showGrid && (
        <Source id="grid" type="geojson" data={gridGeojson}>
          <Layer
            id="grid-lines"
            type="line"
            filter={["==", ["get", "kind"], "line"]}
            paint={{
              "line-color": isDarkMode || mapType === "satellite" ? "#ddd8cc" : "#666666",
              "line-width": 0.5,
              "line-opacity": 0.55,
            }}
          />
          <Layer
            id="grid-latitude-labels"
            type="symbol"
            filter={["==", ["get", "axis"], "latitude"]}
            layout={{
              "text-field": ["get", "label"],
              "text-font": ["Noto Sans Bold"],
              "text-size": showFaults ? 11 : 10,
              "text-anchor": "left",
              "text-allow-overlap": true,
              "text-ignore-placement": true,
            }}
            paint={{
              "text-color": isDarkMode || mapType === "satellite" ? "#ffffff" : "#333333",
              "text-halo-color": isDarkMode || mapType === "satellite" ? "#222222" : "#ffffff",
              "text-halo-width": 1,
            }}
          />
          <Layer
            id="grid-longitude-labels"
            type="symbol"
            filter={["==", ["get", "axis"], "longitude"]}
            layout={{
              "text-field": ["get", "label"],
              "text-font": ["Noto Sans Bold"],
              "text-size": showFaults ? 11 : 10,
              "text-anchor": "center",
              "text-allow-overlap": true,
              "text-ignore-placement": true,
            }}
            paint={{
              "text-color": isDarkMode || mapType === "satellite" ? "#ffffff" : "#333333",
              "text-halo-color": isDarkMode || mapType === "satellite" ? "#222222" : "#ffffff",
              "text-halo-width": 1,
            }}
          />
        </Source>
      )}
      {mapType === "roadmap" && (
        <Source id="glacier-labels-src" type="geojson" data={GLACIER_LABELS_GEOJSON}>
          {GLACIER_LABELS.map(({ name, minZoom }) => (
            <Layer
              key={`glacier-label-${name}`}
              id={`glacier-label-${name}`}
              type="symbol"
              minzoom={minZoom}
              filter={["==", ["get", "name"], name]}
              layout={{
                "text-field": ["get", "name"],
                "text-font": ["Noto Sans Bold"],
                "text-size": ["interpolate", ["linear"], ["zoom"], 4.5, 10, 6, 11, 8, 13],
                "text-anchor": "center",
                "text-allow-overlap": false,
                "text-ignore-placement": false,
              }}
              paint={{
                "text-color": "#0369a1",
                "text-halo-color": "#ffffff",
                "text-halo-width": 2,
              }}
            />
          ))}
        </Source>
      )}
      <MapLibreFaultsOverlay show={showFaults} />
      {volcanoes.length > 0 && (
        <MapLibreVolcanoMarkers
          volcanoes={volcanoes}
          selectedVolcano={selectedVolcano}
          onSelect={onVolcanoClick}
        />
      )}
    </MapLibreMap>
  );
};

const MapComponent = ({
  earthquakes,
  volcanoes = [],
  maxMagnitude,
  mapType,
  showGrid,
  showFaults = false,
  colorOwner,
  isDarkMode,
  selectedVolcano,
  onSelectVolcano,
  aboutOpen = false,
  resetViewTrigger = 0,
  rightPanelOpen = false,
  mobileLeftPanelOpen = false,
}) => {
  const t = useT();
  const [selectedEarthquake, setSelectedEarthquake] = useState(null);
  const [shakeUrl, setShakeUrl] = useState(null);
  const [loadedMapType, setLoadedMapType] = useState(null);
  const mapReady = loadedMapType === mapType;
  const handleMapReady = useCallback(() => setLoadedMapType(mapType), [mapType]);

  useEffect(() => {
    if (!aboutOpen) return;
    setSelectedEarthquake(null);
    setShakeUrl(null);
    onSelectVolcano(null);
  }, [aboutOpen, onSelectVolcano]);

  useEffect(() => {
    setLoadedMapType(null);
    if (mapType !== "heatmap") return undefined;
    const id = window.setTimeout(() => setLoadedMapType("heatmap"), 600);
    return () => window.clearTimeout(id);
  }, [mapType]);

  // Clear selections when switching to heatmap
  useEffect(() => {
    if (mapType === "heatmap") {
      setSelectedEarthquake(null);
      onSelectVolcano(null);
    }
  }, [mapType, onSelectVolcano]);


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

  const handleMarkerClick  = useCallback((quake)   => { onSelectVolcano(null); setSelectedEarthquake(quake); }, [onSelectVolcano]);
  const handleVolcanoClick = useCallback((volcano) => { setSelectedEarthquake(null); onSelectVolcano(volcano);    }, [onSelectVolcano]);
  const handleMapClick     = useCallback(()        => { setSelectedEarthquake(null); onSelectVolcano(null);       }, [onSelectVolcano]);

  return (
    <div
      className={`map-container${rightPanelOpen ? " right-panel-open" : ""}${mobileLeftPanelOpen ? " mobile-left-panel-open" : ""}`}
      style={{ position: "relative" }}
    >
      {!mapReady && (
        <div className="map-loading-overlay">
          <span>{t('loading_map')}</span>
        </div>
      )}

      {mapType === "heatmap" ? (
        <>
          <MapContainer
            center={CENTER}
            zoom={4.5}
            minZoom={4.5}
            style={{ width: "100vw", height: "100vh" }}
            zoomControl={false}
            attributionControl={false}
            zoomAnimation={true}
            fadeAnimation={true}
            markerZoomAnimation={true}
            preferCanvas={true}
            zoomSnap={0}
            zoomDelta={0.25}
            wheelDebounceTime={16}
            wheelPxPerZoomLevel={160}
          >
            <TileLayerManager key={mapType} mapType={mapType} onReady={handleMapReady} />
            <FitIcelandOnReady />
            <MapViewResetter trigger={resetViewTrigger} />
            <MapReadyHandler />
            <MapUiResizeHandler />
            <RightClickHandler />
            <AttributionControl position="bottomright" prefix={false} />
            <CompactAttribution mapType={mapType} showFaults={showFaults} />
            <ScaleControl position="bottomright" />
            <GlacierLabelsOverlay visible={false} />
            <GridOverlay show={showGrid} isDarkMode={isDarkMode} mapType={mapType} emphasizeLabels={showFaults} />
            <FaultsOverlay show={showFaults} />
            <MapClickHandler onClick={handleMapClick} />
            <HeatmapLayer earthquakes={earthquakes} />
            {volcanoes.length > 0 &&
              volcanoes.map((volcano, index) => (
                <VolcanoMarker
                  key={`volcano-${index}`}
                  volcano={volcano}
                  onSelect={handleVolcanoClick}
                  isSelected={selectedVolcano?.name === volcano.name}
                />
              ))}
          </MapContainer>
          <HeatmapLegend />
        </>
      ) : (
        <MapLibreEarthquakeMap
          earthquakes={earthquakes}
          volcanoes={volcanoes}
          maxMagnitude={maxMagnitude}
          mapType={mapType}
          showGrid={showGrid}
          showFaults={showFaults}
          colorOwner={colorOwner}
          isDarkMode={isDarkMode}
          selectedEarthquake={selectedEarthquake}
          selectedVolcano={selectedVolcano}
          onMarkerClick={handleMarkerClick}
          onMapClick={handleMapClick}
          onVolcanoClick={handleVolcanoClick}
          onReady={handleMapReady}
          resetViewTrigger={resetViewTrigger}
        />
      )}

      {selectedEarthquake && (
        <div className="info-card info-card--earthquake">
          <div className="info-card__header">
            <span className="info-card__title">{t('info_earthquake')}</span>
            <button className="info-card__close" onClick={() => setSelectedEarthquake(null)} title="Close">✕</button>
          </div>
          <div className="info-card__body">
            <div className="info-card__magnitude">Mpgv {selectedEarthquake.Mw_mean ?? "N/A"}</div>
            <div className="info-card__rows">
              <div className="info-card__row"><span>{t('info_depth')}</span><span>{selectedEarthquake.Depth != null ? Number(selectedEarthquake.Depth).toFixed(1) : "N/A"} km</span></div>
              <div className="info-card__row"><span>{t('info_time')}</span><span className="eq-time">{selectedEarthquake["Date-time"]}</span></div>
              <div className="info-card__row"><span>{t('info_lat')}</span><span>{selectedEarthquake.Latitude != null ? Number(selectedEarthquake.Latitude).toFixed(4) : "N/A"}</span></div>
              <div className="info-card__row"><span>{t('info_lon')}</span><span>{selectedEarthquake.Longitude != null ? Number(selectedEarthquake.Longitude).toFixed(4) : "N/A"}</span></div>
            </div>
            {shakeUrl && shakeUrl.url && (
              <button
                className="info-card__action"
                onClick={() => window.open(shakeUrl.url, "_blank", "noopener,noreferrer")}
                title={`ShakeMap (Δt ${Math.round(shakeUrl.dt_sec)} s, Δd ${shakeUrl.dist_km?.toFixed(1)} km, ΔM ${shakeUrl.dm ?? "–"})`}
              >
                {t('info_view_shakemap')}
              </button>
            )}
          </div>
        </div>
      )}

      {selectedVolcano && (
        <div className="info-card info-card--volcano">
          <div className="info-card__header">
            <span className="info-card__title">{selectedVolcano.name}</span>
            <button className="info-card__close" onClick={() => onSelectVolcano(null)} title="Close">✕</button>
          </div>
          <div className="info-card__body">
            {selectedVolcano.description && (
              <p className="info-card__desc">{selectedVolcano.description}</p>
            )}
            <div className="info-card__rows">
              <div className="info-card__row">
                <span>{t('info_elevation')}</span>
                <span>
                  {Number.isFinite(+selectedVolcano.elevation_m) && +selectedVolcano.elevation_m > 0
                    ? `${Math.round(+selectedVolcano.elevation_m)} m / ${Math.round(+selectedVolcano.elevation_m * 3.28084)} ft`
                    : t('info_unknown')}
                </span>
              </div>
              <div className="info-card__row">
                <span>{t('info_lat')}</span>
                <span>{Number(selectedVolcano.latitude).toFixed(4)}</span>
              </div>
              <div className="info-card__row">
                <span>{t('info_lon')}</span>
                <span>{Number(selectedVolcano.longitude).toFixed(4)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MapComponent;
