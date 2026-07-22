import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from "react";
import MapLibreMap, { NavigationControl, Source, Layer, Marker, ScaleControl as MapLibreScaleControl, useControl, useMap as useMapLibre } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ScatterplotLayer } from "@deck.gl/layers";
import "maplibre-gl/dist/maplibre-gl.css";
import "maplibre-gl";
import "./MapComponent.css";
import { fetchShakeMapValidated } from "../api";
import { parseBackendUtcDate } from "../utils/datetime";
import { useT } from "../i18n";

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

/* Timeline colour palette — North Atlantic ocean depth, oldest (bright teal) → newest (dark navy).
   Stops mirror the TimeWindowSlider track gradient exactly, mapped by year.
   Year-based (not month) so each earthquake's dot matches its position on the slider. */
const TIMELINE_YEAR_STOPS = [
  "#78d8e8", // 2020 — bright teal (oldest)
  "#5ec4de", // 2021
  "#45add4", // 2022
  "#3590c0", // 2023
  "#2874aa", // 2024
  "#164068", // 2025
  "#0a1628", // 2026 — deep navy (most recent)
];
const SATELLITE_TIMELINE_YEAR_STOPS = [
  "#ff8adb",
  "#dc3fba",
  "#c026a8",
  "#a31997",
  "#7f117f",
  "#5d0a62",
  "#3b063f",
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

const OPENFREEMAP_DARK_STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
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
  heatmap: OPENFREEMAP_DARK_STYLE_URL,
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
  heatmap: "<a href='https://openfreemap.org/'>OpenFreeMap</a> | <a href='https://openmaptiles.org/'>OpenMapTiles</a> | <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a>",
};
const MOBILE_ATTRIBUTIONS = {
  roadmap: "<a href='https://openmaptiles.org/'>OpenMapTiles</a> | <a href='https://www.openstreetmap.org/copyright'>OSM</a>",
  satellite: "<a href='https://www.esri.com/'>Esri</a>",
  terrain: "<a href='https://www.vedur.is/'>IMO</a> | <a href='https://www.openstreetmap.org/copyright'>OSM</a>",
  heatmap: "<a href='https://openmaptiles.org/'>OpenMapTiles</a> | <a href='https://www.openstreetmap.org/copyright'>OSM</a>",
};
const HIKE_METADATA_URL = "https://metadata.europe-geology.eu/record/basic/604a286d-bab0-46be-9e9e-46940a010833";

const MOBILE_MAPLIBRE_ATTRIBUTIONS = {
  roadmap: MOBILE_ATTRIBUTIONS.roadmap,
  satellite: COMPACT_ATTRIBUTIONS.satellite,
  terrain: COMPACT_ATTRIBUTIONS.terrain,
  heatmap: MOBILE_ATTRIBUTIONS.heatmap,
};

const compactMobileMapLibreStyleAttribution = (style, mapType) => {
  if (!style || typeof style === "string") return style;
  const attribution = MOBILE_MAPLIBRE_ATTRIBUTIONS[mapType] ?? MOBILE_MAPLIBRE_ATTRIBUTIONS.roadmap;
  let assigned = false;
  const sources = Object.fromEntries(
    Object.entries(style.sources ?? {}).map(([sourceId, source]) => {
      const nextSource = { ...source };
      delete nextSource.attribution;
      if (!assigned) {
        nextSource.attribution = attribution;
        assigned = true;
      }
      return [sourceId, nextSource];
    })
  );
  return assigned ? { ...style, sources } : style;
};


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
const HIDDEN_HEATMAP_LAYERS = new Set([
  ...HIDDEN_ROADMAP_LAYERS,
  "landuse_residential",
  "landuse_park",
  "building",
  "boundary_state",
  "boundary_country_z0-4",
  "boundary_country_z5-",
]);


// Cached raw style promise — one fetch shared by roadmap and labels overlay
let _rawStylePromise = null;
const fetchRawStyle = () => {
  if (!_rawStylePromise)
    _rawStylePromise = fetch(OPENFREEMAP_STYLE_URL).then(r => r.json());
  return _rawStylePromise;
};

let _darkStylePromise = null;
const fetchDarkStyle = () => {
  if (!_darkStylePromise)
    _darkStylePromise = fetch(OPENFREEMAP_DARK_STYLE_URL).then(r => r.json());
  return _darkStylePromise;
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
const GLACIER_ICE_LAYER_TOKEN = /(^|[^a-z])(glacier|ice(?:[_ -]?shelf)?|ice[_ -]?cap|icecap|snow)([^a-z]|$)/i;

const isGlacierOrIceStyleLayer = (layer) => GLACIER_ICE_LAYER_TOKEN.test([
  layer.id,
  layer["source-layer"],
  JSON.stringify(layer.filter ?? null),
].filter(Boolean).join(" "));


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
const patchStyle = (
  raw,
  labelsOnly = false,
  labelTheme = "light",
  { hideGlaciers = false, hiddenLayerIds = HIDDEN_ROADMAP_LAYERS } = {}
) => {
  const theme = LABEL_THEMES[labelTheme] ?? LABEL_THEMES.light;
  let layers = raw.layers
    .filter(l => labelsOnly || !hiddenLayerIds.has(l.id))
    .filter(l => !hideGlaciers || !isGlacierOrIceStyleLayer(l))
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
  } else if (!hideGlaciers) {
    layers = insertGlacierLayers(raw, layers);
  }
  return { ...raw, layers };
};

const patchDarkHeatmapStyle = (raw) => {
  const style = patchStyle(raw, false, "dark", {
    hideGlaciers: true,
    hiddenLayerIds: HIDDEN_HEATMAP_LAYERS,
  });
  const sources = Object.fromEntries(
    Object.entries(style.sources ?? {}).map(([sourceId, source]) => [
      sourceId,
      source?.type === "vector"
        ? { ...source, attribution: COMPACT_ATTRIBUTIONS.heatmap }
        : source,
    ])
  );
  return { ...style, sources };
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

const ignoreCleanupError = () => undefined;

const useMobileAttribution = () => {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches
  );

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(query.matches);
    update();
    if (query.addEventListener) {
      query.addEventListener("change", update);
      return () => query.removeEventListener("change", update);
    }
    query.addListener(update);
    return () => query.removeListener(update);
  }, []);

  return isMobile;
};

const MapLibreAttributionDefaultState = ({ isMobile }) => {
  const { current: map } = useMapLibre();

  useLayoutEffect(() => {
    if (!isMobile) return;
    const container = map?.getContainer()?.querySelector(".maplibregl-ctrl-attrib");
    if (!container) return;
    container.classList.add("maplibregl-compact");
    container.classList.remove("maplibregl-compact-show");
    container.removeAttribute("open");
  }, [map, isMobile]);

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

const LATITUDE_LABEL_WIDTH = 80;
const LATITUDE_LABEL_CONTROL_GAP = 10;
const LATITUDE_LABEL_TOP_GAP = 8;
const MOBILE_LATITUDE_LABEL_RIGHT_INSET = 52;

const getLatitudeLabelLayout = (mapContainer, mapWidth) => {
  const fallback = { anchorX: mapWidth - MOBILE_LATITUDE_LABEL_RIGHT_INSET, minY: 24 };
  if (!mapContainer || typeof document === "undefined") return fallback;

  const mapRect = mapContainer.getBoundingClientRect();
  const mapTypeControl = document.querySelector(".map-type-control-container");
  const controlRect = mapTypeControl?.getBoundingClientRect();
  const dropdownRect = mapTypeControl?.querySelector(".map-type-dropdown")?.getBoundingClientRect();
  const exclusionBottom = Math.max(
    controlRect?.bottom ?? mapRect.top + 16,
    dropdownRect?.bottom ?? controlRect?.bottom ?? mapRect.top + 16
  );
  const minY = Math.max(24, exclusionBottom - mapRect.top + LATITUDE_LABEL_TOP_GAP);

  if (mapWidth <= 767) {
    const rightControlRail = mapContainer.querySelector(".maplibregl-ctrl-bottom-right");
    const railRect = rightControlRail?.getBoundingClientRect();
    const dynamicRightInset = railRect ? Math.max(0, mapRect.right - railRect.right) : 0;

    return {
      anchorX: Math.max(LATITUDE_LABEL_WIDTH, mapWidth - MOBILE_LATITUDE_LABEL_RIGHT_INSET - dynamicRightInset),
      minY,
    };
  }

  if (!controlRect) return { ...fallback, minY };

  return {
    anchorX: Math.max(
      LATITUDE_LABEL_WIDTH,
      Math.min(mapWidth - LATITUDE_LABEL_CONTROL_GAP, controlRect.left - mapRect.left - LATITUDE_LABEL_CONTROL_GAP)
    ),
    minY,
  };
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
const getHeatWeight = (magnitude) => {
  if (magnitude >= 5.0) return 0.45;
  if (magnitude >= 4.0) return 0.30;
  return 0.20;
};

const MapLibreHeatmapLegendControl = () => {
  const t = useT();
  const controlRef = useRef(null);

  useControl(() => {
    const control = {
      onAdd() {
        const container = document.createElement("div");
        container.className = "maplibregl-ctrl heatmap-legend maplibre-heatmap-legend";

        const title = document.createElement("div");
        title.className = "heatmap-legend-title";

        const bar = document.createElement("div");
        bar.className = "heatmap-legend-bar";

        const labels = document.createElement("div");
        labels.className = "heatmap-legend-labels";
        const low = document.createElement("span");
        const high = document.createElement("span");
        labels.append(low, high);
        container.append(title, bar, labels);

        control.container = container;
        control.title = title;
        control.low = low;
        control.high = high;
        control.orderFrame = requestAnimationFrame(() => {
          const parent = container.parentElement;
          const scale = parent?.querySelector(".maplibregl-ctrl-scale");
          if (scale && container.nextElementSibling !== scale) {
            parent.insertBefore(container, scale);
          }
        });
        return container;
      },
      onRemove() {
        if (control.orderFrame) cancelAnimationFrame(control.orderFrame);
        control.container?.remove();
        control.container = null;
      },
    };
    controlRef.current = control;
    return control;
  }, { position: "bottom-right" });

  useEffect(() => {
    const control = controlRef.current;
    if (!control?.container) return;
    control.title.textContent = t("heatmap_density");
    control.low.textContent = t("heatmap_low");
    control.high.textContent = t("heatmap_high");
  }, [t]);

  return null;
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
  const { anchorX: latLabelX, minY: latLabelMinY } = getLatitudeLabelLayout(map.getContainer(), mapWidth);
  const latLabelYOffset = -6;
  const lngLabelY = mapHeight - 34;
  const lngLabelXOffset = 24;
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
    if (labelY < latLabelMinY || labelY > mapHeight - 38) continue;
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

    const labelX = map.project([lng, map.getCenter().lat]).x + lngLabelXOffset;
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
            <div class="tectonic-legend__row"><span class="tec-swatch tec-swatch--fissure-line"></span><span>Fissure</span></div>
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
  focusEarthquake,
  rightPanelOpen = false,
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
  const [darkHeatmapStyle, setDarkHeatmapStyle] = useState(null);
  const isMobileAttribution = useMobileAttribution();
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

  const heatmapGeojson = useMemo(() => ({
    type: "FeatureCollection",
    features: earthquakes
      .map((quake) => {
        const latitude = Number(quake.Latitude);
        const longitude = Number(quake.Longitude);
        const magnitude = Number(quake.Mw_mean);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(magnitude)) return null;
        return {
          type: "Feature",
          geometry: { type: "Point", coordinates: [longitude, latitude] },
          properties: { weight: getHeatWeight(magnitude) },
        };
      })
      .filter(Boolean),
  }), [earthquakes]);

  useEffect(() => {
    const overlay = deckOverlayRef.current;
    if (!overlay) return;


    if (mapType === "heatmap") {
      overlay.setProps({ layers: [] });
      return;
    }

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
  }, [deckData, mapType, onMarkerClick, selectedEarthquake, viewZoom]);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    attachDeckOverlay(map);
  }, [attachDeckOverlay, mapType, styledMapStyle]);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    const stage = map?.getContainer()?.closest(".map-stage");
    if (!map || !stage || typeof ResizeObserver === "undefined") return undefined;

    let frame = null;
    const resize = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        map.resize();
      });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    resize();

    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [mapType]);


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

  useEffect(() => {
    const quake = focusEarthquake?.quake;
    if (!quake || mapType === "heatmap") return;
    const latitude = Number(quake.Latitude);
    const longitude = Number(quake.Longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    const mapContainer = map.getContainer();
    const mapBounds = mapContainer.getBoundingClientRect();
    const leftDrawer = mapContainer
      .closest(".map-container")
      ?.querySelector(".left-panel__drawer");
    const drawerBounds = leftDrawer?.getBoundingClientRect();
    const leftPadding = drawerBounds
      ? Math.max(
          0,
          Math.min(mapBounds.width, drawerBounds.right - mapBounds.left),
        )
      : 0;
    map.flyTo({
      center: [longitude, latitude],
      zoom: Math.max(map.getZoom(), 9),
      padding: { top: 0, right: 0, bottom: 0, left: leftPadding },
      retainPadding: false,
      duration: 900,
      essential: true,
    });
  }, [focusEarthquake, mapType]);

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
    if (!showGrid) return undefined;
    updateGrid();

    const control = document.querySelector(".map-type-control-container");
    const handleTransitionEnd = (event) => {
      if (event.propertyName === "right") updateGrid();
    };
    const observer = typeof MutationObserver !== "undefined" && control
      ? new MutationObserver(updateGrid)
      : null;
    control?.addEventListener("transitionend", handleTransitionEnd);
    if (control && observer) observer.observe(control, { childList: true, subtree: true });

    return () => {
      control?.removeEventListener("transitionend", handleTransitionEnd);
      observer?.disconnect();
    };
  }, [rightPanelOpen, showGrid, updateGrid]);


  useEffect(() => {
    let cancelled = false;
    if (mapType === "heatmap") {
      setStyledMapStyle(null);
      fetchDarkStyle()
        .then((raw) => {
          if (!cancelled) setDarkHeatmapStyle(patchDarkHeatmapStyle(raw));
        })
        .catch((error) => {
          console.error("Unable to load the OpenFreeMap dark style", error);
          if (!cancelled) setDarkHeatmapStyle(null);
        });
      return () => {
        cancelled = true;
      };
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

  const baseMapStyle = mapType === "heatmap"
    ? darkHeatmapStyle
    : styledMapStyle ?? (MAPLIBRE_STYLES[mapType] ?? MAPLIBRE_STYLES.roadmap);
  const activeMapStyle = useMemo(
    () => !baseMapStyle || !isMobileAttribution
      ? baseMapStyle
      : compactMobileMapLibreStyleAttribution(baseMapStyle, mapType),
    [baseMapStyle, isMobileAttribution, mapType]
  );

  if (!activeMapStyle) return null;

  return (
    <MapLibreMap
      key={mapType}
      ref={mapRef}
      initialViewState={initialViewState}
      style={{ width: "100%", height: "100%" }}
      mapStyle={activeMapStyle}
      maxBounds={ICELAND_BOUNDS_LNG_LAT}
      minZoom={4}
      maxZoom={18}
      renderWorldCopies={false}
      attributionControl={isMobileAttribution
        ? { compact: true }
        : {
            compact: false,
            customAttribution: '<a href="https://maplibre.org/" target="_blank">MapLibre</a>',
          }}
      onLoad={handleMapLoad}
      onMove={(event) => setViewZoom(event.viewState.zoom)}
      onMoveEnd={updateGrid}
      onZoomEnd={updateGrid}
      onClick={handleMapClick}
      cursor={hoveringEarthquakeRef.current ? "pointer" : "grab"}
    >
      <NavigationControl position="bottom-right" />
      <MapLibreAttributionDefaultState isMobile={isMobileAttribution} />
      {showFaults && <MapLibreFaultsLegendControl />}
      {mapType === "heatmap" && <MapLibreHeatmapLegendControl />}
      <MapLibreScaleControl position="bottom-right" />
      {mapType === "heatmap" && (
        <Source id="earthquake-heatmap" type="geojson" data={heatmapGeojson}>
          <Layer
            id="earthquake-heatmap-density"
            type="heatmap"
            maxzoom={18}
            paint={{
              "heatmap-weight": ["get", "weight"],
              "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 4, 0.75, 8, 1.15, 12, 1.4],
              "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 4, 34, 6, 34, 8, 24, 12, 16],
              "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.88, 10, 0.72, 14, 0.55],
              "heatmap-color": [
                "interpolate", ["linear"], ["heatmap-density"],
                0, "rgba(30, 27, 75, 0)",
                0.2, "#1e1b4b",
                0.35, "#2563eb",
                0.5, "#14b8a6",
                0.65, "#f59e0b",
                0.8, "#f97316",
                1, "#dc2626",
              ],
            }}
          />
        </Source>
      )}
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
              "text-anchor": "right",
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
  selectedEarthquake,
  setSelectedEarthquake,
  focusEarthquake,
  shakeUrl,
  setShakeUrl,
}) => {
  const t = useT();
  const [loadedMapType, setLoadedMapType] = useState(null);
  const mapReady = loadedMapType === mapType;
  const handleMapReady = useCallback(() => setLoadedMapType(mapType), [mapType]);

  useEffect(() => {
    if (!aboutOpen) return;
    setSelectedEarthquake(null);
    setShakeUrl(null);
    onSelectVolcano(null);
  }, [aboutOpen, onSelectVolcano, setSelectedEarthquake, setShakeUrl]);

  useEffect(() => {
    setLoadedMapType(null);
  }, [mapType]);

  useEffect(() => {
    if (mapType === "heatmap") {
      setSelectedEarthquake(null);
      onSelectVolcano(null);
    }
  }, [mapType, onSelectVolcano, setSelectedEarthquake]);


  useEffect(() => {
    if (!selectedEarthquake) return;
    const still = earthquakes.some(
      (q) =>
        q["Date-time"] === selectedEarthquake["Date-time"] &&
        q.Latitude === selectedEarthquake.Latitude &&
        q.Longitude === selectedEarthquake.Longitude
    );
    if (!still) setSelectedEarthquake(null);
  }, [earthquakes, selectedEarthquake, setSelectedEarthquake]);

  useEffect(() => {
    if (!selectedEarthquake) return;
    const t = setTimeout(() => setSelectedEarthquake(null), 15000);
    return () => clearTimeout(t);
  }, [selectedEarthquake, setSelectedEarthquake]);

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
  }, [selectedEarthquake, setShakeUrl]);

  const handleMarkerClick  = useCallback((quake)   => { onSelectVolcano(null); setSelectedEarthquake(quake); }, [onSelectVolcano, setSelectedEarthquake]);
  const handleVolcanoClick = useCallback((volcano) => { setSelectedEarthquake(null); onSelectVolcano(volcano);    }, [onSelectVolcano, setSelectedEarthquake]);
  const handleMapClick     = useCallback(()        => { setSelectedEarthquake(null); onSelectVolcano(null);       }, [onSelectVolcano, setSelectedEarthquake]);

  return (
    <div
      className={`map-stage${rightPanelOpen ? " right-panel-open" : ""}${mobileLeftPanelOpen ? " mobile-left-panel-open" : ""}`}
    >
      {!mapReady && (
        <div className="map-loading-overlay">
          <span>{t('loading_map')}</span>
        </div>
      )}

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
            focusEarthquake={focusEarthquake}
            rightPanelOpen={rightPanelOpen}
      />
      {selectedEarthquake && !mobileLeftPanelOpen && (
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
