# Iceland Earthquake Monitoring - Leaflet Edition

Near-real-time Iceland earthquake monitoring web application built as part of an MSc thesis at the University of Iceland (Haskoli Islands).

## Overview

The app visualizes Icelandic earthquakes from June 2020 onward, focusing on events with **M >= 3.0**. A Flask backend continuously ingests and reconciles earthquake data, refreshes volcano metadata, and serves a merged catalogue to a React/Leaflet frontend.

This is the Leaflet version of the original Google Maps project. It does not require a Google Maps API key.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, react-leaflet 4, Leaflet, MapLibre GL, leaflet.heat |
| Map tiles | OpenFreeMap map tiles, IMO terrain, Esri World Imagery, CARTO light/dark tiles |
| Backend | Python 3, Flask, SQLAlchemy, APScheduler |
| Database | SQLite with WAL mode |
| Tests | pytest backend tests, Vitest + Testing Library frontend tests |

## Data Sources

- **MPGV** - public earthquake listings scraped from [hraun.vedur.is/ja/Mpgv/](http://hraun.vedur.is/ja/Mpgv/)
- **Skjalftalisa API** - detailed event metadata from the Icelandic Met Office ([api.vedur.is](https://api.vedur.is/?urls.primaryName=Skj%C3%A1lftal%C3%ADsa))
- **EPOS API** - volcano catalogue and ShakeMap information from [api.vedur.is (EPOS)](https://api.vedur.is/?urls.primaryName=EPOS)
- **EGDI/HIKE WFS** - Iceland fault and fissure linework filtered to onshore records from [EGDI metadata](https://metadata.europe-geology.eu/record/basic/604a286d-bab0-46be-9e9e-46940a010833)

## Update Cadence

| Dataset | How it updates |
|---|---|
| Earthquakes | Backend scheduler runs every 3 minutes: scrape MPGV, fetch recent Skjalftalisa rows, reconcile merged catalogue |
| Volcanoes | Backend scheduler refreshes EPOS volcano metadata every 3 minutes; frontend reloads `/volcanoes` every 3 minutes |
| Faults / fissures | Frontend fetches EGDI/HIKE WFS GeoJSON when the overlay is enabled and refreshes it every 3 minutes while visible |
| ShakeMaps | Looked up on demand when an earthquake info card is opened |

## Reconciliation Algorithm

Each MPGV event is matched against Skjalftalisa records using three thresholds:

| Criterion | Threshold |
|---|---|
| Time difference | <= 2 seconds |
| Distance | < 10 km |
| Magnitude difference | < 3.0 |

When a unique match is found, the Skjalftalisa location and depth replace the MPGV values. The frontend and CSV export use the merged table and keep the public display threshold at **M >= 3.0**.

## Features

- Interactive earthquake markers with timeline and magnitude colour modes
- Time window slider with day, week, month, and year filtering
- Magnitude filter with default minimum **M 3.0**
- Volcano overlay and right-side volcano list from EPOS metadata
- Faults overlay from EGDI/HIKE WFS, filtered to Iceland onshore records (`country_cd === "IS"`, `observ_meth !== "sonar survey"`)
- Fault/fissure legend with solid red fault lines and dotted red fissure lines
- ShakeMap lookup button for eligible earthquake info cards
- CSV export of the merged earthquake catalogue
- Lat/lon grid overlay with zoom-aware spacing
- Default map-view button that returns to the Iceland opening view without reloading
- Heatmap mode for density-first analysis

## Map Layers

| Layer | Provider | Notes |
|---|---|---|
| Map | OpenFreeMap vector style via MapLibre | Default map base with custom glacier handling and labels |
| Satellite | Esri World Imagery | Visual imagery context |
| Terrain | Icelandic Meteorological Office raster tiles | `geo.vedur.is` terrain basemap |
| Gray | CARTO light basemap | Quiet inspection layer |
| Heatmap | CARTO dark base + `leaflet.heat` + label overlay | Earthquake density visualization |

## Heatmap Layer

The heatmap is density-first. Every earthquake contributes a base weight of 1.0, M 4-5 events receive a small 1.15 boost, and M 5+ events receive 1.3. The gradient runs from transparent through dark blue, teal, amber, orange, and red. Individual markers are hidden while heatmap mode is active.

`leaflet.heat` is loaded dynamically after `window.L = L` to avoid module-hoisting issues.

## Project Structure

```text
iceland-quake-monitoring-leaflet/
|-- backend/
|   |-- app.py                  # Flask API, scheduler, SQLAlchemy models
|   |-- scrape.py               # MPGV HTML scraper
|   |-- skjalftalisa_client.py  # Skjalftalisa API client
|   |-- reconcile.py            # Merge algorithm
|   |-- volcano_scraper.py      # EPOS volcano ingestion
|   |-- data/                   # SQLite database, gitignored
|   |-- venv/                   # Python virtualenv, gitignored
|   `-- tests/                  # pytest tests
`-- frontend/
    |-- src/
    |   |-- components/         # Map, panels, overlays, slider, scale
    |   |-- api.js              # API helpers
    |   `-- __tests__/          # Vitest component tests
    `-- vite.config.js
```

## Running Locally

Backend, port 5001:

```bash
backend/venv/Scripts/python.exe backend/app.py
```

Frontend, port 5174:

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5174](http://localhost:5174). The frontend points to `http://localhost:5001` during local development.

## Production Deployment

1. Run the backend with a production WSGI server, for example:

   ```bash
   gunicorn -b 0.0.0.0:5001 app:app --chdir backend
   ```

2. Build the frontend static assets:

   ```bash
   cd frontend
   npm run build
   ```

3. Serve `frontend/dist/` with nginx, Apache, or another static file server. In production the frontend expects the API on the same origin, so configure a reverse proxy for `/earthquakes`, `/earthquakes_csv`, `/volcanoes`, `/shakemap*`, `/scrape-volcanoes`, `/reconcile`, and `/health` as appropriate.

4. Review tile-provider licensing before public deployment.

## Running Tests

Backend:

```bash
cd backend
python -m pytest tests/ -v
```

Frontend:

```bash
cd frontend
npm test
```

## Configuration

| Setting | Value |
|---|---|
| Public magnitude threshold | M >= 3.0 |
| Scheduler interval | Every 3 minutes |
| Reconcile max distance | 10 km |
| Reconcile max time difference | 2 seconds |
| Reconcile max magnitude difference | 3.0 |
| Database location | `backend/data/earthquakes.db` |

## Performance Notes

| Component | Technique |
|---|---|
| `EarthquakeMarkers` | Uses Leaflet layer groups and targeted marker updates |
| `TimeWindowSlider` | Stable wheel listener via `useRef`, memoized divider generation |
| `MapComponent` tiles | `updateWhenZooming=false`, `updateWhenIdle=false`, `keepBuffer=4`, `detectRetina=false` |
| `HeatmapLayer` | Rebuilt only on data changes and `zoomend`; panning does not redraw |
| `FaultsOverlay` | Fetches filtered WFS GeoJSON only when enabled, then refreshes on a timer |

## Map Tile Licensing

The app uses public third-party map tiles and data services. Confirm licensing before public or institutional deployment.

| Layer | Provider |
|---|---|
| Map | OpenFreeMap / OpenMapTiles / OpenStreetMap |
| Satellite | Esri World Imagery |
| Terrain | Icelandic Meteorological Office terrain raster tiles |
| Gray | CARTO light tiles |
| Heatmap base | CARTO dark tiles |

No Google Maps API key is used. If deployed formally at IMO or another institution, prefer institution-owned tile infrastructure or provider accounts/keys where required by licence terms.

## Credits

- Muhammad Faheem Sajjad
- Kristjan Jonasson
- Esa Olavi Hyytia

University of Iceland | (c) 2025-2026
