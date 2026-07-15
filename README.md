# MPGV Monitor

Near-real-time Iceland earthquake monitoring web application built as part of an MSc thesis at the University of Iceland.

## Overview

The app visualizes Icelandic earthquakes from June 2020 onward, focusing on events with **M >= 3.0**. A Flask backend ingests and reconciles earthquake data, refreshes volcano metadata, and serves a merged catalogue to a responsive React/MapLibre interface. The application does not use Google Maps or require a Google Maps API key.

## Current Deployment

- Live Pluto URL: `http://pluto.cs.hi.is/mpgv/`
- Pluto backend port: `6000` behind the Pluto `/mpgv/` route
- Pluto project path: `~/iceland-quake`
- Pluto deploy command from the server project root: `./deploy.sh`
- Local development frontend: `http://localhost:5174`
- Local development backend: `http://localhost:5001`

The deploy copy in `F:\iceland-quake-monitoring-leaflet-deploy-test` is the source used for Pluto uploads.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, MapLibre GL, deck.gl, Recharts |
| Map tiles | OpenFreeMap Positron/dark styles, IMO terrain, Esri World Imagery |
| Backend | Python 3, Flask, SQLAlchemy, APScheduler |
| Database | SQLite with WAL mode |
| API protection | Flask-Limiter with environment-configurable per-client limits |
| Tests | pytest backend tests, Vitest + Testing Library frontend tests |

## Data Sources

- **MPGV** - public earthquake listings scraped from `hraun.vedur.is/ja/Mpgv/`
- **Quakes API** - detailed event metadata from the Icelandic Met Office
- **EPOS API** - volcano catalogue and ShakeMap information from the Icelandic Met Office
- **EGDI/HIKE WFS** - Iceland fault and fissure linework filtered to onshore records

## Update Cadence

| Dataset | How it updates |
|---|---|
| Earthquakes | Backend scheduler runs every 3 minutes: scrape MPGV, fetch recent Quakes API rows, reconcile merged catalogue |
| Volcanoes | Backend scheduler refreshes EPOS volcano metadata every 3 minutes; frontend reloads `/volcanoes` every 3 minutes |
| Faults / fissures | Frontend fetches filtered EGDI/HIKE WFS GeoJSON on first use and caches it for later toggles |
| ShakeMaps | Looked up on demand when an earthquake info card is opened |

## Reconciliation Algorithm

Each MPGV event is matched against Quakes API records using three thresholds:

| Criterion | Threshold |
|---|---|
| Time difference | <= 2 seconds |
| Distance | < 10 km |
| Magnitude difference | < 3.0 |

When a unique match is found, the Quakes API location and depth replace the MPGV values. The frontend and CSV export use the merged table and keep the public display threshold at **M >= 3.0**.

Each Quakes API event is used at most once in the merged catalogue. If multiple MPGV rows compete for the same Quakes event, the best candidate by time difference, distance, and magnitude difference is matched; the other MPGV rows remain `v_only`. This prevents one physical Quakes event from being represented as multiple matched rows.

## Features

- Interactive MapLibre/deck.gl earthquake markers with timeline and magnitude colour modes
- Larger invisible click/tap targets without increasing visible marker size
- Time window slider with day, week, month, and year filtering
- Magnitude filter with default minimum **M 3.0**
- Volcano overlay and right-side volcano list from EPOS metadata
- Faults overlay from EGDI/HIKE WFS, filtered to Iceland onshore records
- Fault/fissure legend with solid red fault lines and dotted red fissure lines
- Compact bottom-right attribution for the active basemap, plus EGDI/HIKE attribution when faults are visible
- ShakeMap lookup button for eligible earthquake info cards
- CSV export of the merged earthquake catalogue
- Lat/lon grid overlay using Iceland-focused graticule spacing
- Main latitude labels plus unlabeled latitude midlines between main lines
- Longitude labels anchored near the bottom with collision spacing
- Default map-view button that returns to the Iceland opening view without reloading
- Recent Selections panel containing the latest ten unique marker selections, with map return actions
- Responsive desktop and mobile controls and information layouts
- MapLibre Heatmap mode for density-first analysis with subdued per-event weights; individual selection is unavailable in this view
- Earthquake and volcano info cards positioned near the upper-left map work area
- Dedicated `/mpgv/analysis` page with shared date, magnitude, depth, source, and time-grouping filters
- Responsive summary cards and six interactive charts with tooltips, range brushes, and PNG/SVG/CSV chart exports
- Strongest and recent earthquake tables with sorting, pagination, and marker-focused **View on map** handoff
- Filtered catalogue CSV download and print-ready analysis output for browser PDF saving
- Depth analysis defaults to Quakes API reference depths from matched events; MPGV-only depths remain raw and can be included with explicit unverified labels
- Reference and unverified depths are separated in charts, tooltips, tables, and CSV exports, with extreme raw values grouped into a labelled overflow bin

## Map Layers

| Layer | Provider | Notes |
|---|---|---|
| Map | OpenFreeMap Positron vector basemap | Default map base |
| Satellite | Esri World Imagery | Visual imagery context |
| Terrain | Icelandic Meteorological Office raster tiles | `geo.vedur.is` terrain basemap |
| Heatmap | OpenFreeMap dark style + MapLibre heatmap layer | Earthquake density visualization without individual markers |

MapLibre GL renders all four current map views. Roadmap uses the OpenFreeMap Positron vector style; Satellite and Terrain combine raster sources with MapLibre labels.

## Heatmap Layer

The heatmap is density-first. M 3-4 events contribute weight 0.20, M 4-5 events contribute 0.30, and M 5+ events contribute 0.45, so nearby clusters dominate over isolated large events. The gradient runs from transparent through dark blue, teal, amber, orange, and red. Individual markers are hidden while heatmap mode is active.

Heatmap mode intentionally hides marker-only controls, clears active marker selection, and closes Recent Selections.

## Project Structure

```text
iceland-quake-monitoring-leaflet/
|-- backend/
|   |-- app.py                  # Flask API, scheduler, SQLAlchemy models
|   |-- scrape.py               # MPGV HTML scraper
|   |-- skjalftalisa_client.py  # Quakes API client
|   |-- reconcile.py            # Merge algorithm
|   |-- volcano_scraper.py      # EPOS volcano ingestion
|   |-- data/                   # SQLite database, gitignored
|   |-- venv/                   # Python virtualenv, gitignored
|   `-- tests/                  # pytest tests
`-- frontend/
    |-- src/
    |   |-- analysis/           # Analysis page, charts, filters, tables, transforms, exports
    |   |-- components/         # Map, panels, overlays, slider, scale
    |   |-- api.js              # API helpers
    |   `-- __tests__/          # Vitest component tests
    `-- vite.config.js
```

## Running Locally

Local development runs as your current user and uses separate frontend and backend dev servers. These ports are not the Pluto production port.

From the repository root:

```bash
npm run dev
```

This starts:

| Service | URL |
|---|---|
| Frontend | `http://127.0.0.1:5174` |
| Backend | `http://127.0.0.1:5001` |

The backend scheduler is disabled by default for faster UI testing. To run the local background refresh jobs too:

```bash
DISABLE_SCHEDULER=0 npm run dev
```

To stop a detached local backend if one is left running:

```bash
npm run dev:stop
```

## Pluto Deployment

The Pluto server runs the app from `~/iceland-quake`. Gunicorn listens locally on port `6000`, and Pluto serves the public URL at `http://pluto.cs.hi.is/mpgv/`.

Typical update flow:

1. Apply and verify changes in the main F project.
2. Copy the same relevant changes to the deploy F project.
3. Mirror the same files into the G recovery folders.
4. Build and test locally.
5. Commit and push both F Git repositories.
6. Upload deploy F changes to Pluto.
7. On Pluto, run:

```bash
cd ~/iceland-quake
./deploy.sh
```

`deploy.sh` installs Python and Node dependencies, builds the frontend, stops the old Gunicorn process, and starts Gunicorn on port `6000` with frontend base path `/mpgv/`. The explicit equivalent is:

```bash
./deploy.sh --port 6000 --base-url /mpgv/
```

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

Recommended frontend quality gate:

```bash
cd frontend
npm audit --audit-level=low
npm run lint
npm run build
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
| Frontend build target | Modern browsers, `esnext` Vite/esbuild output |
| Default API rate limit | `300 per minute` per client |
| Earthquake/volcano API limits | `120 per minute` per client |
| ShakeMap API limit | `60 per minute` per client |
| CSV export limit | `10 per minute` per client |
| Rate limit storage | `RATE_LIMIT_STORAGE`, defaults to `memory://`; use shared storage such as Redis for multi-worker production |

Rate limiting protects request frequency, not total user capacity. See `RATE_LIMITING.md` for the policy, defaults, and production notes.

## Performance Notes

| Component | Technique |
|---|---|
| Earthquake markers | deck.gl scatterplot layers with separate invisible hit targets for easier selection |
| `TimeWindowSlider` | Stable wheel listener via `useRef`, memoized divider generation |
| Map rendering | MapLibre styles and raster sources share one active map component |
| Heatmap | MapLibre GPU heatmap layer with zoom-responsive radius and intensity |
| Fault overlay | Fetches filtered WFS GeoJSON on first use, then reuses the in-memory cache |
| Attribution | Uses one compact bottom-right attribution line instead of stacked provider strings |
| Map layer | Uses the OpenFreeMap Positron vector style through MapLibre GL |

## Map Tile Licensing

The app uses public third-party map tiles and data services. Confirm licensing before public or institutional deployment.

| Layer | Provider |
|---|---|
| Map | OpenFreeMap / OpenMapTiles / OpenStreetMap |
| Satellite | Esri World Imagery |
| Terrain | Icelandic Meteorological Office terrain raster tiles |
| Heatmap base | OpenFreeMap dark style |

No Google Maps API key is used. If deployed formally at IMO or another institution, prefer institution-owned tile infrastructure or provider accounts/keys where required by licence terms.

## Credits

- Muhammad Faheem Sajjad
- Kristjan Jonasson
- Esa Olavi Hyytia

University of Iceland | 2025-2026
