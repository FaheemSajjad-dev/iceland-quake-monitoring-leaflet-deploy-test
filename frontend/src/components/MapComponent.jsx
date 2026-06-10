import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { MapContainer, TileLayer, ScaleControl, AttributionControl, useMap, useMapEvents } from "react-leaflet";
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

const MIN_MAG = 3.0;
const MAG_PALETTE_STOPS = ["#f5a623", "#e07030", "#c43c28", "#8f1a1a", "#4a0a0a"];

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
const TIMELINE_BASE_YEAR = 2020;

const getTwilightColorForDate = (isoString) => {
  if (!isoString) return TIMELINE_YEAR_STOPS[3];
  const d = parseBackendUtcDate(isoString);
  if (!d) return TIMELINE_YEAR_STOPS[3];
  const idx = Math.max(0, Math.min(
    TIMELINE_YEAR_STOPS.length - 1,
    d.getUTCFullYear() - TIMELINE_BASE_YEAR
  ));
  return TIMELINE_YEAR_STOPS[idx];
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
    maxNativeZoom: 17,
  },
  terrain: {
    url: "https://geo.vedur.is/geoserver/www/imo_basemap_epsg3857/{z}/{x}/{y}.png",
    attribution: "Icelandic Met Office | Natural Science Institute of Iceland | &copy; OpenStreetMap contributors",
    maxZoom: 19,
    maxNativeZoom: 14,
  },
  gray: {
    url: "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a> &copy; <a href="https://openstreetmap.org">OpenStreetMap</a>',
    maxZoom: 19,
    maxNativeZoom: 18,
    subdomains: "abcd",
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

const OPENFREEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
const OPENFREEMAP_ATTRIBUTION = "MapLibre | <a href='https://openfreemap.org'>OpenFreeMap</a> &copy; <a href='https://openmaptiles.org'>OpenMapTiles</a> Data from <a href='https://openstreetmap.org'>OpenStreetMap</a>";
const ROADMAP_RASTER_FALLBACK = {
  url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
  attribution: "&copy; <a href='https://carto.com/attributions'>CARTO</a> &copy; <a href='https://openstreetmap.org'>OpenStreetMap</a>",
  maxZoom: 19,
  maxNativeZoom: 18,
  subdomains: "abcd",
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
  { name: "Vatnajökull", lat: 64.42, lng: -16.80, minZoom: 4.5, priority: 1 },
  { name: "Langjökull", lat: 64.73, lng: -19.90, minZoom: 4.5, priority: 2 },
  { name: "Hofsjökull", lat: 64.82, lng: -18.90, minZoom: 4.5, priority: 3 },
  { name: "Drangajökull", lat: 66.15, lng: -22.25, minZoom: 4.5, priority: 4 },
  { name: "Snæfellsjökull", lat: 64.81, lng: -23.78, minZoom: 5.2, priority: 5 },
  { name: "Eiríksjökull", lat: 64.77, lng: -20.40, minZoom: 5.2, priority: 6 },
  { name: "Mýrdalsjökull", lat: 63.65, lng: -19.10, minZoom: 5.4, priority: 7 },
  { name: "Öræfajökull", lat: 64.03, lng: -16.65, minZoom: 6.0, priority: 8 },
  { name: "Tungnafellsjökull", lat: 64.73, lng: -17.92, minZoom: 6.2, priority: 9 },
  { name: "Eyjafjallajökull", lat: 63.64, lng: -19.62, minZoom: 6.4, priority: 10 },
];

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
  const hiddenRoadmapLayers = labelsOnly ? new Set() : new Set(["park", "landcover_wood"]);
  let layers = raw.layers
    .filter(l => !hiddenRoadmapLayers.has(l.id))
    .filter(l => !labelsOnly || (l.type === "symbol" && l.layout?.["text-field"]))
    .map(l => {

      if (!l.layout?.["text-field"]) return l;
      const layer = {
        ...l,
        layout: { ...l.layout, "text-field": IS_NAME_EXPR },
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

const addRasterRoadmapFallback = (map, onReady) => {
  const layer = L.tileLayer(ROADMAP_RASTER_FALLBACK.url, {
    attribution: ROADMAP_RASTER_FALLBACK.attribution,
    maxZoom: ROADMAP_RASTER_FALLBACK.maxZoom,
    maxNativeZoom: ROADMAP_RASTER_FALLBACK.maxNativeZoom,
    subdomains: ROADMAP_RASTER_FALLBACK.subdomains,
    zIndex: 1,
    ...TILE_PROPS,
  });

  if (onReady) layer.once("load", onReady);
  layer.addTo(map);

  return () => {
    if (onReady) layer.off("load", onReady);
    try {
      if (map.hasLayer(layer)) map.removeLayer(layer);
    } catch {
      ignoreCleanupError();
    }
  };
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

const MaplibreVectorLayer = ({ onReady }) => {
  const map = useMap();
  const cleanupRef = useRef(() => {});

  useEffect(() => {
    let dead = false;

    const useRasterFallback = () => {
      if (dead) return;
      cleanupRef.current();
      cleanupRef.current = addRasterRoadmapFallback(map, onReady);
    };

    fetchRawStyle()
      .then(raw => {
        if (dead) return;
        const layerId = "roadmap-positron";
        const gl = createMaplibreLayer(map, {
          layerId,
          style: patchStyle(raw),
          attribution: OPENFREEMAP_ATTRIBUTION,
          fadeDuration: 0,
          collectResourceTiming: false,
          trackResize: false,
          pixelRatio: 1,
          maxTileCacheSize: 20,
          antialias: false,
        });

        if (!gl) {
          useRasterFallback();
          return;
        }

        const teardown = setupGlLayer(gl, map, { layerId, zIndex: "200", onReady, withFullscreen: true });
        cleanupRef.current = () => { teardown(); removeMaplibreLayer(map, gl, layerId); };
      })
      .catch(() => useRasterFallback());

    return () => { dead = true; cleanupRef.current(); cleanupRef.current = () => {}; };
  }, [map, onReady]);

  return null;
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
          attribution: OPENFREEMAP_ATTRIBUTION,
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
        attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a> &copy; <a href="https://openstreetmap.org">OpenStreetMap</a>',
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
  if (mapType === "roadmap") return <MaplibreVectorLayer onReady={onReady} />;
  if (mapType === "heatmap") {
    return (
      <>
        <HeatmapTileLayers onReady={onReady} />
        <MaplibreLabelOverlay paneName="heatmap-labels" paneZIndex={550} labelTheme="dark" />
      </>
    );
  }
  if (mapType === "satellite" || mapType === "terrain" || mapType === "gray") {
    const layer = TILE_LAYERS[mapType];
    return (
      <>
        <TileLayer
          key={mapType}
          url={layer.url}
          attribution={layer.attribution}
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
  const didFit = useRef(false);
  useEffect(() => {
    if (didFit.current) return;
    didFit.current = true;
    map.fitBounds(ICELAND_FIT_BOUNDS, { padding: [10, 10], animate: false });
    const fitZoom = map.getBoundsZoom(L.latLngBounds(ICELAND_FIT_BOUNDS), false, [10, 10]);
    const minZoom = Math.max(4.5, fitZoom - 1.0);
    map.setMinZoom(minZoom);
    map.setView(map.getCenter(), minZoom, { animate: false });
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
    map.fitBounds(ICELAND_FIT_BOUNDS, { padding: [10, 10], animate: true });
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

const GridOverlay = ({ show, isDarkMode, mapType }) => {
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

    let lngGridSpacing, subLngGridSpacing = null;
    if (zoom < 5)       { lngGridSpacing = 4; }
    else if (zoom < 7)  { lngGridSpacing = 2; }
    else if (zoom < 8)  { lngGridSpacing = 1;   subLngGridSpacing = 0.5; }
    else if (zoom < 9)  { lngGridSpacing = 0.5; subLngGridSpacing = 0.25; }
    else                { lngGridSpacing = 0.2; subLngGridSpacing = 0.1; }

    const labelDecimals = 1;
    const latGridSpacing = lngGridSpacing / 2;
    const subLatGridSpacing = subLngGridSpacing !== null ? subLngGridSpacing / 2 : null;
    const isOnStep = (value, step) => Math.abs(value / step - Math.round(value / step)) < 0.001;

    const mainColor  = darkLike ? "#ddd8cc" : "#666666";
    const subColor   = darkLike ? "#bbb5aa" : "#888888";
    const lblColor   = darkLike ? "#ffffff" : "#333333";

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
    const addLabel = (lat, lng, text, color, size, fontWeight = "bold", iconAnchor = [0, 13]) => {
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

    // Safe left margin: 260px clears the left panel and gives latitude labels breathing room.
    // Convert that pixel column back to a geographic longitude so lat labels never
    // land underneath the left-side UI panel regardless of zoom or pan position.
    const SAFE_LEFT_PX = 260;
    const mapHeight = map.getSize().y;
    const safeLatLabelLng = map.containerPointToLatLng([SAFE_LEFT_PX, mapHeight / 2]).lng;
    const latLabelLng = (lng) => Math.max(lng, safeLatLabelLng);

    for (let lat = startLat; lat <= endLat; lat += latGridSpacing) {
      if (lat < -85 || lat > 85) continue;
      addLine([[lat, extW], [lat, extE]], mainColor, 1, 0.8);
      addLabel(lat, latLabelLng(west + (east - west) * 0.02),
        `${lat.toFixed(labelDecimals)}°${lat > 0 ? "N" : lat < 0 ? "S" : ""}`,
        lblColor, "10px", "bold", [0, 16]);
    }
    for (let lng = startLng; lng <= endLng; lng += lngGridSpacing) {
      addLine([[extS, lng], [extN, lng]], mainColor, 1, 0.8);
      addLabel(south + (north - south) * 0.05, lng,
        `${lng.toFixed(labelDecimals)}°${lng > 0 ? "E" : lng < 0 ? "W" : ""}`,
        lblColor, "10px");
    }

    if (subLngGridSpacing !== null && subLatGridSpacing !== null) {
      const sLat = Math.floor(extS / subLatGridSpacing) * subLatGridSpacing;
      const eLat = Math.ceil(extN / subLatGridSpacing) * subLatGridSpacing;
      const sLng = Math.floor(extW / subLngGridSpacing) * subLngGridSpacing;
      const eLng = Math.ceil(extE / subLngGridSpacing) * subLngGridSpacing;

      for (let lat = sLat; lat <= eLat; lat += subLatGridSpacing) {
        if (lat < -85 || lat > 85) continue;
        if (isOnStep(lat, latGridSpacing)) continue;
        addLine([[lat, extW], [lat, extE]], subColor, 0.5, 0.5);
      }
      for (let lng = sLng; lng <= eLng; lng += subLngGridSpacing) {
        if (isOnStep(lng, lngGridSpacing)) continue;
        addLine([[extS, lng], [extN, lng]], subColor, 0.5, 0.5);
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

const getMarkerRadius = (zoom, isSelected) => {
  const base =
    zoom <= 5  ? 1 :
    zoom <= 6  ? 1.5 :
    zoom <= 7  ? 2 :
    zoom <= 8  ? 2.5 :
    zoom <= 9  ? 3 :
    zoom <= 10 ? 3.5 :
    zoom <= 11 ? 4 : 4.5;
  return isSelected ? base + 2 : base;
};

const getQuakeMarkerStyle = (color, isSelected, zoom) => ({
  radius: getMarkerRadius(zoom, isSelected),
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
    const zoom = map.getZoom();
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

      const { color } = markerIcons[index] || {};
      const marker = L.circleMarker([lat, lng], {
        ...getQuakeMarkerStyle(color, isSelected, zoom),
      })
        .on("click", (e) => { L.DomEvent.stopPropagation(e); onMarkerClick(quake); })
        .addTo(lg);
      if (isSelected) marker.bringToFront();

      markersMapRef.current.set(quakeKey(quake), { marker, quake, index });
    });
  }, [map, earthquakes, markerIcons, onMarkerClick]);

  // Resize all markers when zoom changes
  useEffect(() => {
    const handleZoom = () => {
      const zoom = map.getZoom();
      const sel = selectedEqRef.current;
      markersMapRef.current.forEach(({ marker, quake }) => {
        const isSelected =
          sel &&
          quake["Date-time"] === sel["Date-time"] &&
          quake.Latitude === sel.Latitude &&
          quake.Longitude === sel.Longitude;
        marker.setRadius(getMarkerRadius(zoom, isSelected));
      });
    };
    map.on("zoomend", handleZoom);
    return () => map.off("zoomend", handleZoom);
  }, [map]);

  useEffect(() => {
    const prev = prevSelectedRef.current;
    prevSelectedRef.current = selectedEarthquake;

    const zoom = map.getZoom();
    const updateMarker = (quake, isSelected) => {
      if (!quake) return;
      const entry = markersMapRef.current.get(quakeKey(quake));
      if (!entry) return;
      const { color } = markerIconsRef.current[entry.index] || {};
      entry.marker.setStyle(getQuakeMarkerStyle(color, isSelected, zoom));
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
  resetViewTrigger = 0,
}) => {
  const t = useT();
  const [selectedEarthquake, setSelectedEarthquake] = useState(null);
  const [shakeUrl, setShakeUrl] = useState(null);
  const [loadedMapType, setLoadedMapType] = useState(null);
  const mapReady = loadedMapType === mapType;
  const handleMapReady = useCallback(() => setLoadedMapType(mapType), [mapType]);

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
          <span>{t('loading_map')}</span>
        </div>
      )}

      <MapContainer
        center={CENTER}
        zoom={6}
        minZoom={4.5}

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
        <TileLayerManager key={mapType} mapType={mapType} onReady={handleMapReady} />
        <FitIcelandOnReady />
        <MapViewResetter trigger={resetViewTrigger} />
        <MapReadyHandler />
        <ZoomAnimGuard />
        <RightClickHandler />
        <AttributionControl position="bottomright" prefix={false} />
        <ScaleControl position="bottomright" />
        <GlacierLabelsOverlay visible={mapReady && (mapType === "roadmap" || mapType === "satellite")} />
        <GridOverlay show={showGrid} isDarkMode={isDarkMode} mapType={mapType} />
        <FaultsOverlay show={showFaults} />
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

        {mapReady && volcanoes.length > 0 &&
          volcanoes.map((volcano, index) => (
            <VolcanoMarker
              key={`volcano-${index}`}
              volcano={volcano}
              onSelect={handleVolcanoClick}
              isSelected={selectedVolcano?.name === volcano.name}
            />
          ))}
      </MapContainer>

      {mapType === "heatmap" && <HeatmapLegend />}

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
