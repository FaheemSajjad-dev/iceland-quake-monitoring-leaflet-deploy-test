# Iceland Earthquake Monitoring — Leaflet Edition

Real-time Iceland earthquake monitoring web application built as part of an MSc thesis at the University of Iceland (Háskóli Íslands).

---

## Overview

Visualizes earthquakes across Iceland in near-real time, focusing on events with **M ≥ 2.7**. The backend continuously fetches and reconciles data from multiple sources, serving a merged dataset to an interactive Leaflet map.

This is the **Leaflet clone** of the original Google Maps version — no API key required.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite, react-leaflet 4, leaflet.heat |
| Map tiles | OpenStreetMap · Esri World Imagery · CartoDB Dark Matter |
| Backend | Python 3, Flask, SQLAlchemy, APScheduler |
| Database | SQLite (WAL mode) |
| Tests | pytest (backend) · Vitest + Testing Library (frontend) |

---

## Data Sources

- **MPGV** — public earthquake listings scraped from [hraun.vedur.is/ja/Mpgv/](http://hraun.vedur.is/ja/Mpgv/)
- **Skjálftalísa API** — detailed event metadata from the Icelandic Met Office ([api.vedur.is](https://api.vedur.is/?urls.primaryName=Skj%C3%A1lftal%C3%ADsa))
- **EPOS API** — volcano data and ShakeMap information from [api.vedur.is (EPOS)](https://api.vedur.is/?urls.primaryName=EPOS)

### Reconciliation Algorithm

Each MPGV event is matched against Skjálftalísa records using three thresholds:

| Criterion | Threshold |
|---|---|
| Time difference | ≤ 2 seconds |
| Distance | < 10 km |
| Magnitude difference | < 3.0 |

When a unique match is found, the Skjálftalísa location and depth replace the MPGV values. Current coverage: **~81%** of MPGV events matched.

---

## Features

- Interactive map with earthquake markers sized and coloured by magnitude
- **Timeline colour mode** — shades markers by when the event occurred
- **Magnitude colour mode** — shades markers by seismic strength
- **Time window slider** — filter events by day / week / month / year; scroll to zoom, drag to pan
- **Magnitude filter** — slider to set a minimum magnitude threshold
- **Volcano overlay** — 33 Icelandic volcanoes with status and EPOS metadata
- **ShakeMap links** — info window shows a ShakeMap button for eligible events
- **Data export** — download the full merged catalogue as CSV
- **Four map layers:** roadmap, satellite, dark mode, and heatmap (see below)
- **Lat/lon grid overlay** — auto-density grid (0.002°–5° spacing by zoom); labels use a safe-zone calculation to avoid overlapping left-side UI
- Smooth zoom with half-step snapping (`zoomSnap=0.5`, `zoomDelta=0.5`) and pre-buffered tiles (`keepBuffer=4`)

### UI Layout

All controls are aligned at a consistent 20 px margin from their respective screen edge:

| Edge | Controls |
|---|---|
| Left | Map type selector · Timeline slider (vertical) · Colour mode toggle · Volcano + grid toggle row |
| Right | About button · Magnitude scale · Heatmap legend · Scale bar |

The volcano toggle and lat/lon grid toggle share a single row. Info windows (earthquake and volcano) open at 15% from the left edge.

### Heatmap Layer

The **Heatmap** is the 4th map type, designed for density analysis rather than individual event inspection.

| Component | Detail |
|---|---|
| Base tile | CartoDB Dark Matter (no-labels variant) |
| Heat overlay | `leaflet.heat` — count-based density with small magnitude boost |
| Labels tile | CartoDB Dark Matter (labels-only) in a Leaflet `Pane` at z-index 650, rendered above the heat |

**Heatmap weight:** every earthquake counts equally (weight 1.0); events M 4–5 get a small boost (1.15) and M 5+ get 1.3 — density drives the visualization, not magnitude alone.

**Gradient:** transparent → dark blue → steel blue → teal → amber → orange → red. Amber replaces bright yellow to stay readable on dark basemaps.

**Zoom-responsive radius:** pixel radius grows with zoom so clusters stay visible at higher detail levels.

**Density legend:** a gradient bar (Low → High) is shown in the bottom-right when the heatmap is active.

When heatmap mode is active, individual earthquake markers are hidden and the timeline/magnitude colour toggle is not shown.

**Dependency:** `leaflet.heat`

> `leaflet.heat` requires `window.L` to be set before it is imported. It is loaded dynamically inside a `useEffect` after `window.L = L` to avoid a hoisting issue.

---

## Project Structure

```
iceland-quake-monitoring-leaflet/
├── backend/
│   ├── app.py                  # Flask API, scheduler, SQLAlchemy models
│   ├── scrape.py               # MPGV HTML scraper
│   ├── skjalftalisa_client.py  # Skjálftalísa API client
│   ├── reconcile.py            # Merge algorithm (MPGV + Skjálftalísa)
│   ├── volcano_scraper.py      # EPOS volcano data
│   ├── data/                   # SQLite database (gitignored)
│   ├── venv/                   # Python virtualenv (gitignored)
│   └── tests/                  # 37 pytest tests
└── frontend/
    ├── src/
    │   ├── components/         # React components (Map, Slider, Scale, etc.)
    │   ├── api.js              # API calls to backend
    │   └── __tests__/          # Vitest component tests
    └── vite.config.js
```

---

## Running Locally

**Backend** (port 5001):
```bash
backend/venv/Scripts/python.exe backend/app.py
```

**Frontend** (port 5174):
```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5174](http://localhost:5174).

> The frontend `api.js` points to `http://localhost:5001`. Both servers must be running.

---

## Production Deployment

1. **Backend** — disable debug mode and use a production WSGI server:
   ```bash
   # In backend/app.py, line 477: change debug=True → debug=False
   # Then run with gunicorn (Linux/macOS) instead of the Flask dev server:
   gunicorn -b 0.0.0.0:5001 app:app --chdir backend
   ```

2. **Frontend** — build static assets and serve them:
   ```bash
   cd frontend
   npm run build        # outputs to frontend/dist/
   ```
   Serve the `dist/` folder with nginx, Apache, or any static file server. In production the frontend expects the API on the same origin, so configure a reverse proxy to forward `/earthquakes`, `/volcanoes`, `/shakemap*`, and `/scrape*` to the gunicorn backend.

3. **Tile providers** — see the [Map Tile Licensing](#map-tile-licensing--important-for-production-deployment) section below for required licence changes before public deployment.

---

## Running Tests

**Backend** (37 tests):
```bash
cd backend
python -m pytest tests/ -v
```

**Frontend**:
```bash
cd frontend
npm test
```

---

## Configuration

| Setting | Value |
|---|---|
| Magnitude filter | M ≥ 2.7 |
| Scheduler interval | Every 3 minutes |
| Reconcile: max distance | 10 km |
| Reconcile: max time diff | 2 seconds |
| Reconcile: max mag diff | 3.0 |
| DB location | `backend/data/earthquakes.db` |

---

## Performance Notes

Key optimisations applied to the frontend:

| Component | Technique |
|---|---|
| `EarthquakeMarkers` | `L.layerGroup` — single `addTo`/`removeLayer` call hides all markers (O(1)) |
| `EarthquakeMarkers` | Selection change updates only the two affected markers, not the full list |
| `markerIcons` | Computed with `useMemo([earthquakes, colorOwner, maxMagnitude])` |
| `TimeWindowSlider` | Wheel handler registered **once** via a stable `useRef` wrapper; state changes no longer trigger listener re-registration |
| `TimeWindowSlider` | `generateDividers()` output memoized with `useMemo([viewOffset, zoomLevel])` |
| `MapComponent` tile loading | `updateWhenZooming=false`, `updateWhenIdle=false`, `keepBuffer=4`, `detectRetina=false` |
| `HeatmapLayer` | Rebuilt only on data change or `zoomend`; panning does not trigger a redraw |

---

## Map Tile Licensing — Important for Production Deployment

The three tile providers used in development have **usage restrictions** that must be resolved before this application is deployed as a public-facing production service.

| Layer | Provider URL | Development use | Production requirement |
|---|---|---|---|
| Roadmap | `tile.openstreetmap.org` | Permitted for low-traffic testing | **Forbidden** for app distribution / heavy use per [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/). Must use a CDN or self-hosted tiles. |
| Satellite | `server.arcgisonline.com` (Esri) | Free for dev/personal | Requires an **Esri licence** for government / production use |
| Dark Matter + Heatmap base | `basemaps.cartocdn.com` | Free tier with rate limits | Requires a **paid Carto plan** for production |

The underlying **geodata** (OpenStreetMap) is open under the ODbL licence and can be used freely — the restriction is only on the tile-serving CDN.

### Recommended actions before handover to IMO

1. **Check whether IMO already holds a basemap licence** — many national meteorological offices have agreements with Esri or a national mapping agency.
2. **Use a licensed tile CDN** — [Stadia Maps](https://stadiamaps.com/) and [MapTiler](https://www.maptiler.com/) both offer straightforward government/research plans and provide OSM-based roadmap, satellite, and dark-theme tile styles.
3. **Self-host OSM tiles** — if IMO prefers full independence, a Docker-based `osm-tile-server` stack can serve OSM tiles internally.
4. **Swap tile URLs in one place** — all tile layer URLs are defined in the `TILE_LAYERS` constant in `frontend/src/components/MapComponent.jsx` (≈ line 55) and the two CartoDB URLs in `TileLayerManager` (≈ line 84). Swapping providers requires changing only those strings.

The data APIs (`hraun.vedur.is`, `api.vedur.is`) are IMO's own services and require no licensing changes.

---

## Credits

- Muhammad Faheem Sajjad
- Kristján Jónasson
- Esa Olavi Hyytia

University of Iceland · © 2025–2026
