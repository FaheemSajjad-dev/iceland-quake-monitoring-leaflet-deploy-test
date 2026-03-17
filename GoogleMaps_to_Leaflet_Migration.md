# Google Maps API to Leaflet Migration
### Iceland MPGV Earthquake Monitoring Webapp

---

## Overview

Migration of the Iceland earthquake monitoring webapp from **Google Maps JavaScript API**
(via `@react-google-maps/api`) to **Leaflet** (via `react-leaflet`), producing a
pixel-accurate clone with no backend changes and no loss of functionality.

- **Original project:** `f:/iceland-quake-monitoring/`
- **Leaflet clone:**    `f:/iceland-quake-monitoring-leaflet/`

---

## Project Structure

```
iceland-quake-monitoring-leaflet/
  backend/                         <- Identical to original (Flask, SQLite, APScheduler)
    app.py, scrape.py, reconcile.py, volcano_scraper.py
    skjalftalisa_client.py, shakemap_validator.py
    data/earthquakes.db
  frontend/src/
    App.jsx                  <- Unchanged
    App.css                  <- z-index bumps only (2 lines)
    api.js                   <- Unchanged
    utils/datetime.js        <- Unchanged
    components/
      MapComponent.jsx       <- Full rewrite (core migration)
      VolcanoMarker.jsx      <- Rewrite (Leaflet imperative API)
      MagnitudeScale.css     <- z-index fix only (1 line added)
      MapTypeSelector.jsx    <- Unchanged
      TimeWindowSlider.jsx   <- Unchanged
      About.jsx              <- Unchanged
      MapComponent.css       <- Unchanged
```

---

## Step 1 - Cloning Without node_modules

Used Windows `robocopy` to exclude large directories:

```powershell
robocopy "f:\iceland-quake-monitoring" "f:\iceland-quake-monitoring-leaflet" /E
  /XD node_modules dist __pycache__ .git venv .pytest_cache .vs
```

Completed in under 1 second (~8 MB of source files).
Then ran `npm install` inside `frontend/`.

The Python backend reuses the original project venv directly — no reinstall needed:

```powershell
& f:/iceland-quake-monitoring/backend/venv/Scripts/python.exe
    f:/iceland-quake-monitoring-leaflet/backend/app.py
```

---

## Step 2 - Dependency Swap (package.json)

| Removed | Added |
|---|---|
| `@react-google-maps/api ^2.20.8` | `react-leaflet ^4.2.1` |
| `maplibre-gl ^5.18.0` (was unused) | — |
| `pmtiles ^4.4.0` (was unused) | — |

`leaflet ^1.9.4` was already present in the original `package.json` (leftover
from earlier experiments), so no version conflict arose.

---

## Step 3 - Core Migration: MapComponent.jsx

This was the only file requiring a full rewrite.

### 3.1 Map Container

| Google Maps | Leaflet |
|---|---|
| `<GoogleMap mapContainerStyle zoom center onLoad>` | `<MapContainer center zoom minZoom style>` |
| `useJsApiLoader({ googleMapsApiKey })` | Nothing — no API key needed |
| `map.setMapTypeId(type)` | Swap `<TileLayer>` component via React state |

The Google Maps version required an async `isLoaded` check before rendering.
Leaflet is synchronous — the map renders immediately, removing the loading gate.

### 3.2 Tile Layer Switching (Map Types)

Google Maps has built-in `roadmap`, `satellite`, and custom `StyledMapType` (dark mode).
Leaflet uses external free tile providers:

| Google Maps Type | Leaflet Tile Provider |
|---|---|
| `roadmap` | OpenStreetMap: `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png` |
| `satellite` | Esri World Imagery: `.../World_Imagery/MapServer/tile/{z}/{y}/{x}` |
| `dark_mode` | CartoDB Dark Matter: `.../dark_all/{z}/{x}/{y}{r}.png` |

All three providers are **free** and require **no API key**.

A `TileLayerManager` sub-component handles switching, keyed by `mapType` so
React fully replaces the tile layer on change:

```jsx
const TileLayerManager = ({ mapType }) => {
  const layer = TILE_LAYERS[mapType] || TILE_LAYERS.roadmap;
  return <TileLayer key={mapType} url={layer.url} attribution={layer.attribution} />;
};
```

### 3.3 Earthquake Markers

Google Maps used `<Marker>` React components with SVG `url` icons as children of
`<GoogleMap>`. Leaflet's React wrapper does not efficiently support hundreds of
individual React Marker components at runtime.

**Solution:** An imperative `EarthquakeMarkers` sub-component uses `useMap()` to
access the raw Leaflet map instance, creates `L.marker` objects with `L.divIcon`
containing inline SVG — the same rectangle shapes as the original.
All markers are stored in a ref and removed/re-added whenever data changes:

```jsx
const EarthquakeMarkers = ({ earthquakes, markerIcons, selectedEarthquake, onMarkerClick }) => {
  const map = useMap();
  const markersRef = useRef([]);

  useEffect(() => {
    markersRef.current.forEach(m => map.removeLayer(m));
    markersRef.current = [];

    earthquakes.forEach((quake, index) => {
      const { px, color } = markerIcons[index];
      const svg = `<svg ...><rect fill="${color}" .../></svg>`;
      const icon = L.divIcon({ html: svg, iconSize: [px, px], iconAnchor: [px/2, px/2] });
      const marker = L.marker([lat, lng], { icon })
        .on("click", e => { L.DomEvent.stopPropagation(e); onMarkerClick(quake); })
        .addTo(map);
      markersRef.current.push(marker);
    });

    return () => { markersRef.current.forEach(m => map.removeLayer(m)); };
  }, [map, earthquakes, markerIcons, selectedEarthquake, onMarkerClick]);

  return null;
};
```

Colour logic preserved identically:
- **Timeline mode** — Twilight 12-step cyclic palette by UTC month
- **Magnitude mode** — Viridis-style 5-stop palette (`#FDE725` → `#440154`)

Marker pixel size uses the same `pow(t, 0.7)` easing as the original (8–14 px range).

### 3.4 Volcano Markers

`VolcanoMarker` rewritten from a Google Maps `<Marker>` to the same imperative
`useMap()` pattern, using `L.divIcon` with the same orange triangle SVG as the original.

### 3.5 Adaptive Lat/Lon Grid

The most complex part of the migration. Google Maps used:
- `window.google.maps.Polyline` for grid lines
- `window.google.maps.Marker` for coordinate labels

Ported to Leaflet using:
- `L.polyline` for grid lines
- `L.marker` with `L.divIcon` (HTML `<span>` elements) for coordinate labels

The `GridOverlay` sub-component:
1. Accesses the map via `useMap()`
2. Listens to `zoomend` and `moveend` (same as Google's `zoom_changed` / `dragend`)
3. Redraws all grid lines and labels on each event
4. Same adaptive spacing breakpoints:

| Zoom  | Main Grid | Sub-Grid  |
|-------|-----------|-----------|
| < 5   | 5°        | —         |
| < 7   | 2°        | —         |
| < 8   | 1°        | 0.5°      |
| < 9   | 0.5°      | 0.1°      |
| < 11  | 0.2°      | 0.05°     |
| < 13  | 0.1°      | 0.02°     |
| < 15  | 0.05°     | 0.01°     |
| ≥ 15  | 0.01°     | 0.002°    |

5. Main lines: weight 1, opacity 0.8 / Sub-grid: weight 0.5, opacity 0.5
6. Line and label colours adapt to the active tile layer (dark/light)

### 3.6 Map Click Handler

- **Google Maps:** `onClick` prop on `<GoogleMap>`
- **Leaflet:** `MapClickHandler` sub-component using `useMapEvents({ click })`

### 3.7 Scale Control

- **Google Maps:** `scaleControl: true` in map options
- **Leaflet:** `<ScaleControl position="bottomright" />`

Positioned `bottomright` so it stacks automatically above the attribution/copyright line.

### 3.8 Info Panels (Earthquake + Volcano)

Plain React `div` elements positioned absolutely over the map — **not** Google Maps
`InfoWindow` components. They were already plain divs in the original, so zero changes
were required. All behaviour is identical:
- Auto-close after 15 seconds
- Auto-deselect if earthquake disappears from the filtered set
- ShakeMap button with USGS link when a validated match is found

---

## Step 4 - Z-Index Fixes

Leaflet's internal map panes use z-index values (200, 400, 600...) creating stacking
contexts that covered several UI elements outside the Leaflet container.
Three CSS fixes applied **only in the clone**:

| File | Selector | Old z-index | New z-index | Reason |
|---|---|---|---|---|
| `App.css` | `.about-button-container` | 11 | 1001 | About button hidden behind map |
| `App.css` | `.controls` | 10 | 1001 | Page title hidden behind map |
| `MagnitudeScale.css` | `.magnitude-scale.vertical` | (none) | 1000 | Scale bar not visible |

All controls **inside** MapComponent (`map-type-control`, `color-toggle-container`,
`volcano-toggle-container`, `grid-toggle-container`) already had `z-index: 1000`
in the original CSS and required no changes.

---

## What Was NOT Changed

**Backend:**
- All Python files (`app.py`, `scrape.py`, `reconcile.py`, etc.)
- All unit tests (37 passing)
- SQLite database schema and data pipeline

**Frontend:**
- `App.jsx` — identical, same props interface
- `api.js` — identical, same endpoints (`/earthquakes`, `/volcanoes`, `/shakemap/:dt`)
- `MapTypeSelector.jsx` — same UI, same `onMapTypeChange` callback
- `TimeWindowSlider.jsx` / `.css` — unchanged
- `About.jsx` / `.css` — unchanged
- `MagnitudeScale.jsx` — unchanged (only CSS touched)
- `MapComponent.css` — unchanged
- `vite.config.js`, `index.html`, `eslint.config.js` — unchanged

---

## Running the Leaflet Version

**Terminal 1 — Backend:**
```powershell
& f:/iceland-quake-monitoring/backend/venv/Scripts/python.exe f:/iceland-quake-monitoring-leaflet/backend/app.py
```

**Terminal 2 — Frontend:**
```bash
cd f:/iceland-quake-monitoring-leaflet/frontend
npm run dev
```

Open: `http://localhost:5173`

---

## Summary

The migration required changes to **3 source files** and **2 CSS files** in the frontend.
The backend was completely untouched. The result is a fully functional webapp that is
visually and functionally identical to the Google Maps version, runs entirely on free
open-source tile providers with no API key, and has no external billing dependency.
