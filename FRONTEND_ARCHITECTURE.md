# Frontend Architecture & Design Decisions

## Iceland Earthquake Monitoring System — Frontend Documentation

---

## 1. Technology Stack

| Component | Technology |
|-----------|-----------|
| UI Framework | React 18 |
| Build Tool | Vite |
| Map Library | Leaflet 1.9 + react-leaflet 4.2 |
| Heatmap | leaflet.heat 0.2 |
| HTTP Client | Axios |
| Testing | Vitest + React Testing Library |

### Why Leaflet Instead of Google Maps?

The original version used the Google Maps JavaScript API, which requires a billing-linked API key and charges per map load beyond the free tier. Leaflet is open-source, needs no API key, and pulls tiles from free providers (OSM, Esri, CartoDB). For a research project that may eventually be handed off to IMO, removing the billing dependency was the main motivation.

---

## 2. Application Architecture

### 2.1 Component Tree

```
App.jsx (root)
    |
    +-- MapComponent.jsx
    |       |
    |       +-- TileLayerManager        (map tile switching)
    |       +-- MinZoomController        (zoom boundary enforcement)
    |       +-- MapReadyHandler          (layout initialisation)
    |       +-- GridOverlay              (lat/lon coordinate grid)
    |       +-- EarthquakeMarkers        (seismic event markers)
    |       +-- HeatmapLayer             (density visualisation)
    |       +-- HeatmapLegend            (density scale bar)
    |       +-- MapClickHandler          (deselection on empty click)
    |       +-- VolcanoMarker.jsx        (individual volcano markers)
    |       +-- MapTypeSelector.jsx      (layer type dropdown)
    |       +-- Earthquake Info Popup    (event details on click)
    |       +-- Volcano Info Popup       (volcano details on click)
    |
    +-- TimeWindowSlider.jsx             (interactive timeline control)
    |
    +-- MagnitudeScale.jsx               (magnitude filter slider)
    |
    +-- About.jsx                        (project information modal)
```

### 2.2 Data Flow Diagram

```
         +-----------+
         |  Backend  |
         |  (Flask)  |
         +-----+-----+
               |
         GET /earthquakes  (every 3 min)
         GET /volcanoes     (every 3 min)
               |
               v
         +-----------+
         |  api.js   |  <-- axios HTTP client
         +-----------+
               |
               v
    +----------+-----------+
    |       App.jsx        |
    |                      |
    | State:               |
    |  allData []          |  <-- raw earthquake array from API
    |  filteredData []     |  <-- after date + magnitude filter
    |  volcanoData []      |  <-- volcano locations
    |  maxMagnitude        |  <-- dynamic max from allData
    |  magnitudeFilter     |  <-- user-set minimum (default 2.7)
    |  dateRange {}        |  <-- from TimeWindowSlider
    |  isDarkMode          |  <-- from MapTypeSelector
    |  colorOwner          |  <-- 'timeline' or 'magnitude'
    +----------+-----------+
               |
    +----------+----------+-----------------+
    |                     |                 |
    v                     v                 v
+--------+      +--------------+    +-------------+
| Map    |      | TimeWindow   |    | Magnitude   |
| Comp.  |      | Slider       |    | Scale       |
+--------+      +--------------+    +-------------+
    |                  |                    |
    | earthquakes      | onFilterChange    | onMagnitudeFilter
    | volcanoes        |    (dateRange)    |    Change
    | maxMagnitude     |                   |
    v                  v                   v
  [renders map]    [updates App         [updates App
                    dateRange state]     magnitudeFilter]
```

### 2.3 Filtering Pipeline

```
allData (all earthquakes from API)
    |
    +-- Date Filter (from TimeWindowSlider)
    |     |
    |     +-- Month precision: compare year*100 + month
    |     +-- Day precision:   compare year*10000 + month*100 + day
    |
    +-- Magnitude Filter (from MagnitudeScale)
    |     |
    |     +-- Keep only earthquakes where Mw >= filterValue
    |
    v
filteredData --> passed to MapComponent for rendering
```

---

## 3. Map Component (`MapComponent.jsx`)

### 3.1 Map Configuration

| Setting | Value | Purpose |
|---------|-------|---------|
| Centre | [64.9631, -19.0208] | Centre of Iceland |
| Initial zoom | 6 | Shows all of Iceland |
| Min zoom | 5.5 | Prevents zooming out too far |
| Max zoom | 19 | Allows street-level detail |
| zoomSnap | 0.5 | Smooth half-step zoom increments |
| zoomDelta | 0.5 | Each scroll step = half zoom level |
| wheelPxPerZoomLevel | 60 | Requires ~120px scroll for 1 full zoom level |
| preferCanvas | true | Uses Canvas renderer for faster marker drawing |

### 3.2 Tile Layers

```
+-------------------+---------------------------+------------------+
|   Map Type        |   Tile Provider           |   Max Native Zoom|
+-------------------+---------------------------+------------------+
|   Roadmap         |   OpenStreetMap           |   19             |
|   Satellite       |   Esri World Imagery      |   17 (upscaled)  |
|   Dark Mode       |   CartoDB Dark Matter     |   19             |
|   Heatmap         |   CartoDB Dark (no labels)|   19             |
|                   |   + CartoDB Labels overlay|                  |
+-------------------+---------------------------+------------------+
```

**Tile performance settings**:
- `updateWhenZooming: false` — prevents blank tile flicker during zoom animation
- `keepBuffer: 4` — keeps 4 tiles beyond viewport for smoother panning
- `detectRetina: false` — consistent tile resolution across devices

### 3.3 Earthquake Markers

**Rendering approach**: Imperative Leaflet API (L.marker + L.divIcon)

```
For each earthquake in filteredData:
    1. Create SVG icon (24x24 px square)
    2. Color based on colorOwner mode:
       - Timeline: month-based palette (purple -> green, 12 entries)
       - Magnitude: interpolated 5-stop gradient (yellow -> purple)
    3. Add to LayerGroup (batch add/remove for performance)
    4. On click: show info popup (top-right corner)
```

**Selection behaviour**:
- Selected marker gets white 2px border + slight size increase
- Only 2 markers update on selection change (old + new) — O(1) operation
- Previous selection reverts to normal icon

**Marker colour palettes**:

**Timeline mode** (month-based, Twilight-inspired):
```
Jan: #2c115f (deep purple)     Jul: #78d6a3 (seafoam green)
Feb: #421f7e (dark violet)     Aug: #a9d882 (light green)
Mar: #5e4fa2 (indigo)          Sep: #e0c857 (golden)
Apr: #577bb7 (steel blue)      Oct: #e8894a (tangerine)
May: #69b5cf (sky blue)        Nov: #cf5246 (coral)
Jun: #5ec4a0 (mint)            Dec: #6e1e3e (burgundy)
```

**Magnitude mode** (continuous gradient):
```
Low Mw  ------>  High Mw
#f5e642   #3bb58d   #2a7fb5   #4b3a9e   #1e0a3c
(yellow)  (green)   (teal)    (indigo)  (dark purple)
```

### 3.4 Heatmap Layer

**Plugin**: leaflet.heat (lazy-loaded on first use)

```
Earthquake data --> [lat, lng, weight] array --> L.heatLayer()
```

**Weight calculation**:
```
Base weight = 1.0 for all events
   + 0.15 bonus for Mw 4.0 - 5.0
   + 0.30 bonus for Mw > 5.0
```

**Radius scaling with zoom level**:

| Zoom Level | Radius (px) | Purpose |
|-----------|-------------|---------|
| <= 5 | 15 | Overview: broad seismic zones |
| 6 | 22 | Regional patterns visible |
| 7 | 30 | Individual clusters emerge |
| 8 | 40 | Cluster details |
| 9 | 50 | High detail |
| > 9 | 58 | Maximum detail |

**Gradient** (7-stop, transparent to deep red):
```
0.0: transparent
0.15: dark indigo (#160a30)
0.3: deep blue (#1a237e)
0.45: teal (#00695c)
0.6: amber (#f9a825)
0.8: orange (#ef6c00)
1.0: deep red (#b71c1c)
```

**Rebuild triggers**: zoom change only (not pan) — avoids unnecessary recalculation.

### 3.5 Grid Overlay (Lat/Lon Coordinate Grid)

**Adaptive spacing based on zoom level**:

| Zoom Range | Main Grid | Sub-grid | Purpose |
|-----------|-----------|----------|---------|
| < 5 | 5.0 degrees | — | Coarse overview |
| 5 - 7 | 2.0 degrees | — | Regional scale |
| 7 - 8 | 1.0 degree | 0.5 degrees | Detailed regional |
| 8 - 11 | 0.2 degrees | 0.05 degrees | Local area |
| 11 - 15 | 0.05 degrees | 0.01 degrees | Precise location |
| >= 15 | 0.01 degrees | 0.002 degrees | Micro-precision |

**Visual design**:
- Main grid lines: solid, semi-transparent
- Sub-grid lines: thinner, more transparent
- Labels: positioned at grid intersections using L.divIcon
- Safe zone: 120px left margin to avoid overlapping the TimeWindowSlider
- Colours adapt to map type (dark text on light maps, light text on dark maps)

**Rebuild triggers**: zoom and pan (moveend + zoomend events)

### 3.6 Popup System

**Earthquake info popup** (top-right corner):
```
+----------------------------------+
|  Magnitude: 4.2 Mw              |
|  Depth: 8.3 km                  |
|  Date: 2026-03-15 14:22:31 UTC  |
|  Location: 63.92°N, 22.31°W     |
|                                  |
|  [View ShakeMap]  (if available) |
+----------------------------------+
```

**Volcano info popup** (top-right corner):
```
+----------------------------------+
|  Hekla                           |
|  Elevation: 1,491 m (4,892 ft)  |
|  Location: 63.98°N, 19.70°W     |
+----------------------------------+
```

**Auto-close**: Both popups auto-dismiss after 15 seconds.

---

## 4. TimeWindowSlider (`TimeWindowSlider.jsx`)

### 4.1 Purpose

An interactive vertical timeline that lets users select a date range to filter earthquakes on the map. Supports multiple zoom levels from full history (2020-present) down to individual days.

### 4.2 View Modes

```
Zoom Level:  0.01 ---------> 0.04 ---------> 0.15 ---------> 0.95 ---------> 1.0
             |                |                |                |                |
             DAY VIEW         WEEK VIEW        MONTH VIEW       YEAR VIEW
             (3-30 days)      (1-4 weeks)      (1-N months)     (full history)
```

| Mode | Zoom Range | Visible Span | Divider Type | Label Format |
|------|-----------|-------------|-------------|-------------|
| Day | < 0.04 | 3 - 30 days | Daily lines | `"5 Mar 2026"` |
| Week | 0.04 - 0.15 | 1 - 4 weeks | Daily lines | `"5 Mar 2026"` |
| Month | 0.15 - 0.95 | 1 - N months | Monthly lines | `"Mar 2026"` |
| Year | >= 0.95 | Full dataset | Yearly lines | `"2021"` |

### 4.3 Interaction Model

```
+--------+
| Drag   |  Down = earlier dates, Up = later dates
+--------+  Sensitivity: 0.1x in day mode, 2.0x in month/year mode

+--------+
| Scroll |  Zoom in/out with cursor anchor point
+--------+  Sensitivity: k=0.004 (day/week), k=0.006 (month/year)

+--------+
| Touch  |  Same as drag (mobile support)
+--------+
```

### 4.4 Label Placement Logic

**Year mode** — labels centred between year boundaries (not at boundaries):

```
|         |         |         |         |
|  2021   |  2022   |  2023   |  2024   |
|         |         |         |         |
|    ^    |    ^    |    ^    |    ^    |
    label     label     label     label
  (midpoint of each year band)
```

**Month mode** — year boundary labels use `YY/YY` format:

```
  Nov   Dec  |  Jan   Feb   Mar
             |
           21/22
    (previous / next year)
```

### 4.5 Debouncing

Slider changes are debounced at **200ms** to prevent excessive re-rendering of the map during drag interactions. Visual slider position updates immediately; map filtering happens after the debounce settles.

---

## 5. MagnitudeScale (`MagnitudeScale.jsx`)

### 5.1 Purpose

Vertical slider that sets the minimum magnitude threshold for earthquake display. Earthquakes below this threshold are hidden from the map.

### 5.2 Inverted Display

The slider is visually inverted so that:
- **Top of slider** = lowest threshold (show more earthquakes)
- **Bottom of slider** = highest threshold (show fewer earthquakes)

This matches the intuitive expectation: "raising the bar" = fewer events.

### 5.3 Colour Modes

| Mode | Appearance | When Active |
|------|-----------|-------------|
| Magnitude | Gradient bar (yellow -> purple) | colorOwner = 'magnitude' |
| Timeline | Solid grey bar | colorOwner = 'timeline' |

---

## 6. State Management

### 6.1 Why No Redux/Zustand?

There's one data source (the API), one root component that owns all state, and straightforward top-down prop passing. Adding a state management library would be adding infrastructure for its own sake here.

### 6.2 State Hierarchy

```
App.jsx (owns all state)
    |
    +-- allData            modified by: loadData() (every 3 min)
    +-- filteredData        modified by: dateRange or magnitudeFilter change
    +-- volcanoData         modified by: loadData() (every 3 min)
    +-- maxMagnitude        derived from: allData (recalculated on change)
    +-- magnitudeFilter     modified by: MagnitudeScale user interaction
    +-- dateRange           modified by: TimeWindowSlider user interaction
    +-- isDarkMode          modified by: MapTypeSelector selection
    +-- colorOwner          modified by: MapComponent toggle button
    +-- showVolcanoes       modified by: MapComponent toggle button
    +-- showAbout           modified by: About button click
```

### 6.3 Performance Optimisations

| Technique | Where Used | Purpose |
|-----------|-----------|---------|
| `useMemo` | markerIcons (MapComponent) | Pre-compute all marker icons, only rebuild when data changes |
| `useMemo` | generateDividers (TimeWindowSlider) | Cache divider calculations between renders |
| `useCallback` | Event handlers throughout | Prevent unnecessary child re-renders |
| `useRef` | markersMapRef (EarthquakeMarkers) | Track marker instances without triggering re-renders |
| Debouncing | TimeWindowSlider (200ms), MagnitudeScale (150ms) | Prevent rapid filter updates during drag |
| Lazy import | leaflet.heat plugin | Only load heatmap code when user selects heatmap mode |
| O(1) selection | EarthquakeMarkers | Only update 2 markers (old + new) on selection change |

---

## 7. API Communication (`api.js`)

### 7.1 Endpoint Mapping

| Frontend Function | Backend Endpoint | Frequency |
|-------------------|-----------------|-----------|
| `fetchEarthquakeData()` | `GET /earthquakes` | Every 3 minutes (polling) |
| `fetchVolcanoData()` | `GET /volcanoes` | Every 3 minutes (polling) |
| `triggerVolcanoScrape()` | `GET /scrape-volcanoes` | On-demand (manual) |
| `fetchShakeMapValidated()` | `GET /shakemap_lookup` | On-demand (popup click) |

### 7.2 Base URL Logic

```javascript
const isLocalDev = window.location.hostname === "localhost"
                || window.location.hostname === "127.0.0.1";

API_URL = isLocalDev ? "http://localhost:5001" : "";
//                      ^ local development      ^ production (same-origin)
```

---

## 8. Styling & Layout

### 8.1 Layout Structure

```
+----------------------------------------------------------+
|  Header (title + controls)                    z:1001      |
+----------------------------------------------------------+
|       |                                                   |
| Time  |          Leaflet Map Container                    |
| Window|          z: 400-650 (Leaflet default)             |
| Slider|                                                   |
|       |                              +------------------+ |
|       |                              | Map Type Selector| |
|       |                              +------------------+ |
|       |                                                   |
|       |                     +----------------------------+|
|       |                     | Earthquake/Volcano Popup   ||
|       |                     | (top-right, auto-close 15s)||
|       |                     +----------------------------+|
|       |                                                   |
+-------+                              +------------------+ |
        |                              | Magnitude Scale  | |
        |                              | (bottom-right)   | |
        |                              +------------------+ |
        +---------------------------------------------------+
```

### 8.2 Z-Index Hierarchy

```
Layer                          Z-Index    Purpose
-----                          -------    -------
Leaflet tile pane              200        Base map tiles
Leaflet overlay pane           400        Polylines, polygons
Heatmap labels pane            650        CartoDB label overlay (heatmap mode)
Magnitude Scale                1000       Always above map
Controls (header + slider)     1001       Always above everything
About button                   1001       Always accessible
```

---

## 9. Testing

### 9.1 Frontend Test Suite

| Test File | What It Tests |
|-----------|---------------|
| `TimeWindowSlider.test.jsx` | Component rendering, label logic, interaction behaviour |

### 9.2 Test Infrastructure

- **Runner**: Vitest (Vite-native, fast)
- **DOM**: jsdom (browser-like environment in Node.js)
- **Utilities**: @testing-library/react (user-centric testing)
- **Setup**: `window.matchMedia` stub (prevents errors in non-browser environment)
- **Run**: `cd frontend && npm test`

---

## 10. Build & Development

### 10.1 Development

```bash
cd frontend
npm install       # install dependencies
npm run dev       # start Vite dev server on port 5174
```

### 10.2 Production Build

```bash
npm run build     # outputs to frontend/dist/
```

Vite produces optimised, minified bundles with:
- Tree-shaking (removes unused code)
- Code splitting (lazy-loaded chunks)
- Asset hashing (cache-busting filenames)

### 10.3 Key Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| react | 18.3.1 | UI framework |
| react-dom | 18.3.1 | DOM rendering |
| leaflet | 1.9.4 | Map rendering engine |
| react-leaflet | 4.2.1 | React bindings for Leaflet |
| leaflet.heat | 0.2.0 | Heatmap visualisation plugin |
| axios | 1.7.9 | HTTP client |

---

## 11. File Structure

```
frontend/
    src/
        App.jsx                     # Root component, state, filtering
        App.css                     # Global styles, layout, z-indexes
        api.js                      # Backend API communication
        components/
            MapComponent.jsx        # Main map with all sub-components
            MapComponent.css        # Map-specific styles
            TimeWindowSlider.jsx    # Interactive timeline slider
            TimeWindowSlider.css    # Slider styles
            MagnitudeScale.jsx      # Magnitude filter control
            MagnitudeScale.css      # Scale styles
            MapTypeSelector.jsx     # Map layer type dropdown
            MapTypeSelector.css     # Selector styles
            VolcanoMarker.jsx       # Individual volcano marker
            About.jsx               # Project info modal
            About.css               # Modal styles
        __tests__/
            setup.js                # Test environment setup
            TimeWindowSlider.test.jsx  # Slider component tests
    index.html                      # Entry point
    vite.config.js                  # Vite + test configuration
    package.json                    # Dependencies and scripts
```
