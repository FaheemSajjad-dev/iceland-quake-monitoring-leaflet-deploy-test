# MPGV Monitor project file guide

## High-level architecture

MPGV Monitor is a two-route React application backed by a Flask/SQLite service.

1. `backend/scrape.py` ingests magnitude-3+ MPGV HTML catalogue rows into the `earthquake` source table.
2. `backend/skjalftalisa_client.py` ingests IMO Quakes API GeoJSON into `earthquake_s_raw`.
3. `backend/reconcile.py` makes conservative one-to-one matches and atomically rebuilds `earthquake_merged`. A matched row keeps MPGV time/magnitude and uses the Quakes API location/depth; an unmatched or ambiguous MPGV row remains `v_only`.
4. `backend/app.py` serves the merged catalogue, volcanoes, Insights limits, CSV, ShakeMap lookup, admin operations, health data, and the built React application.
5. `frontend/src/App.jsx` fetches the earthquake catalogue once for both routes, polls every three minutes, filters map records, and owns cross-component selection/navigation state.
6. The map route renders spatial layers through `MapComponent.jsx`; the Insights route computes analysis locally through `analysisData.js` and renders it with Recharts components.

The production topology documented in `DEPLOYMENT_OVERVIEW.md` uses Gunicorn on Pluto port 6000 behind the `/mpgv/` proxy path. The current main repository contains local launch scripts and deployment documentation; the operational `deploy.sh` is maintained in the separate deploy repository, not this source tree.

## Folder-by-folder explanation

### `backend/`

The Flask API, SQLite models, ingestion clients, reconciliation algorithm, ShakeMap audit utility, operational analysis scripts, Python dependency list, and pytest suite. Runtime database contents under `backend/data/` are deliberately outside architecture documentation.

### `frontend/`

The Vite/React client. `src/` contains the map shell, reusable controls, Insights feature, localization, API adapter, utilities, styles, and Vitest/Testing Library tests. `public/` contains the MapLibre style and deployable map assets. Generated `dist/` and installed `node_modules/` are not architecture inputs.

### `tools/`

Offline report-generation utilities used for project/reference documentation. They do not participate in the running map/API path.

### Repository root

Project documentation, local start/stop scripts, dependency metadata, security/rate-limit guidance, deployment topology, and asset-download utilities.

### `project-architecture/`

This isolated architecture explorer. Nothing in the application imports it.

## Main entry points

| Entry point | Role |
|---|---|
| `frontend/index.html` | Browser HTML shell and React module loader |
| `frontend/src/main.jsx` | Creates the React root and language provider |
| `frontend/src/App.jsx` | Frontend composition root and route/data/state coordinator |
| `backend/app.py` | Flask application, model, route, scheduler, and production-asset entry |
| `run-local.sh` | Two-process local launcher for Flask and Vite |

## Important files

| File | Purpose | Main dependencies / communication |
|---|---|---|
| `frontend/src/App.jsx` | Owns catalogue polling, map filtering, routes, responsive panels, and selections | `api.js`, `datetime.js`, map components, lazy `AnalysisPage.jsx` |
| `frontend/src/api.js` | Central browser API adapter and limits-contract validation | Axios/fetch → Flask `/earthquakes`, `/volcanoes`, `/insights/limits`, `/shakemap_lookup` |
| `frontend/src/components/MapComponent.jsx` | MapLibre/deck.gl rendering and spatial interaction | `react-map-gl`, deck.gl, `api.js`, `datetime.js`, `map-style.json` |
| `frontend/src/components/LeftPanel.jsx` | Map filters, layer controls, action rail, mobile event summary | `TimeWindowSlider`, `MagnitudeScale`, `i18n`; sends callbacks to `App.jsx` |
| `frontend/src/components/TimeWindowSlider.jsx` | Multi-resolution date-window interaction | `App.jsx` filter callback and `i18n.jsx` |
| `frontend/src/components/MagnitudeScale.jsx` | Marker-size legend and minimum-magnitude input | `App.jsx` magnitude state |
| `frontend/src/analysis/AnalysisPage.jsx` | Coordinates Insights loading, filters, derived data, rendering, export, and map return | `api.js`, `analysisData.js`, filters/charts/tables/summaries/export |
| `frontend/src/analysis/analysisData.js` | Pure normalization, depth-policy, validation, filtering, aggregation, and histogram logic | `datetime.js`; extensively tested by `analysisData.test.js` |
| `frontend/src/analysis/AnalysisCharts.jsx` | Recharts visualizations and time-range interaction | `ChartCard.jsx`, processed models from `analysisData.js` |
| `backend/app.py` | Models, API, scheduler, security, rate limiting, SPA serving | SQLite, ingestion/reconciliation modules, EPOS ShakeMaps, environment configuration |
| `backend/scrape.py` | MPGV HTML ingestion | MPGV website → `earthquake` table |
| `backend/skjalftalisa_client.py` | IMO Quakes API ingestion | Quakes API → `earthquake_s_raw` table |
| `backend/reconcile.py` | One-to-one source matching and merged-table replacement | Reads `earthquake` + `earthquake_s_raw`; writes `earthquake_merged` |
| `backend/volcano_scraper.py` | Validated EPOS volcano snapshot replacement | EPOS API → `volcano` table |
| `frontend/vite.config.js` | Vite/Vitest base path, server, target, and test environment | `VITE_BASE_PATH`, React plugin, jsdom setup |
| `frontend/package.json` | Frontend libraries and command interface | React, MapLibre, deck.gl, Recharts, Axios, Vitest, ESLint |
| `backend/requirements.txt` | Backend/install dependency contract | Flask, SQLAlchemy, scheduler, limiter, scraping, Gunicorn, pytest stack |
| `DEPLOYMENT_OVERVIEW.md` | Pluto topology and controlled update sequence | Deploy repository, Gunicorn port 6000, `/mpgv/`, private environment file |

## Frontend-to-backend communication

`frontend/src/api.js` derives `API_URL` from the browser host during local development and from Vite's `BASE_URL` in deployment. This preserves same-origin requests under `/mpgv/` while using Flask port 5001 during local Vite development.

| Frontend function | Flask route | Consumer | Data use |
|---|---|---|---|
| `fetchEarthquakeData` | `GET /earthquakes` | `App.jsx` | Full merged catalogue for map and Insights |
| `fetchVolcanoData` | `GET /volcanoes` | `App.jsx` | Volcano markers and right-panel list |
| `fetchInsightsLimits` | `GET /insights/limits?depth_quality=…` | `AnalysisPage.jsx` | Exact magnitude/depth filter boundaries |
| `fetchShakeMapValidated` | `GET /shakemap_lookup?dt=…&lat=…&lon=…` | `MapComponent.jsx` | Validated external ShakeMap link for the selected event |

The Insights charts are **not** fetched from a chart-data endpoint. `App.jsx` supplies the merged earthquake array to `AnalysisPage.jsx`; the browser filters and aggregates it with `analysisData.js`. Only catalogue limits are queried separately so filter controls reflect the selected depth-quality policy.

## Database and reconciliation overview

All five SQLAlchemy models currently live in `backend/app.py`:

| Table / model | Written by | Read by | Purpose |
|---|---|---|---|
| `earthquake` / `Earthquake` | `scrape.py` | `reconcile.py`, health route | Raw MPGV source V |
| `earthquake_s_raw` / `EarthquakeSRaw` | `skjalftalisa_client.py` | `reconcile.py`, health route | Raw Quakes API source S |
| `earthquake_merged` / `EarthquakeMerged` | `reconcile.py` | earthquake, CSV, Insights limits, ShakeMap audit routes/tools | Display/analysis catalogue with provenance |
| `volcano` / `Volcano` | `volcano_scraper.py` | `/volcanoes` | Local EPOS volcano snapshot |
| `shakemap_links` / `ShakeMapLink` | `shakemap_validator.py` | `/shakemap/<dt>` | Audited stored ShakeMap match |

`match_and_merge` accepts a match only when the event is within ±2 seconds, under 10 km, under the magnitude-difference threshold, unambiguous for the MPGV row, and not already assigned to another MPGV event. It builds replacement objects first, deletes/replaces the requested merged time window in one transaction, and rolls back on failure. The current `DEPTH_POLICY = 's'` uses Quakes API depth for matched rows.

## Data ingestion flow

```text
MPGV monthly HTML ──> scrape.py ──> earthquake ─┐
                                                ├─> reconcile.py ─> earthquake_merged
IMO Quakes API ──> skjalftalisa_client.py ─> earthquake_s_raw ─┘

EPOS volcano API ──> volcano_scraper.py ──> volcano
EPOS ShakeMap API ──> app.py live validation ──> selected-event response
```

`backend/app.py` starts an APScheduler interval job unless `DISABLE_SCHEDULER` is set. Every three minutes the guarded job scrapes MPGV, fetches seven recent days from the Quakes API, reconciles from 2020-06-01 through now, refreshes volcanoes, and invalidates the earthquake response cache. `IngestionLock` combines an in-process lock with a runtime lock file to reject overlapping writers.

## Deployment flow

### Local

1. `run-local.sh` creates/reuses `backend/venv` and installs `backend/requirements.txt`.
2. It installs frontend packages if `node_modules` is missing.
3. It starts `backend/app.py` on port 5001 with the scheduler disabled by default.
4. It runs the Vite development server on port 5174.
5. `stop-local.sh` can stop a backend recorded in `.local/backend.pid`.

### Pluto

1. Changes are verified in the main F repository.
2. Matching files are synchronized to the separate F deploy repository and recovery copies.
3. Both Git repositories are committed and pushed.
4. Deploy-source files are uploaded to `~/iceland-quake`.
5. The deploy repository's `deploy.sh` installs dependencies, builds `frontend/dist` with base `/mpgv/`, restarts Gunicorn on port 6000, and writes runtime PID/log files.
6. Pluto nginx proxies the public `/mpgv/` path to Gunicorn. Its configuration is external to this repository.

Private deployment values belong in an ignored `private.env`. The architecture explorer records names such as `ADMIN_TOKEN`; it never reads or records values.

## Configuration flow

Important backend names include `APP_ENV`, `FLASK_ENV`, `PORT`, `BACKEND_PORT`, `FRONTEND_PORT`, row/window ceilings, `TRUSTED_PROXY_COUNT`, rate-limit names, `ADMIN_TOKEN`, `ALLOW_DEV_LOCAL_ADMIN`, `RUNTIME_DIR`, `DISABLE_SCHEDULER`, and `MIN_VALID_VOLCANO_ROWS`. `backend/app.py` reads process environment directly; it does not automatically load an `.env` file.

Frontend build configuration uses `VITE_BASE_PATH` in `vite.config.js`, which becomes `import.meta.env.BASE_URL` in `api.js` and `App.jsx`. This value controls deployed asset paths, API base paths, and the `/analysis` route.

## Testing structure

Backend tests use `backend/tests/conftest.py` to disable the scheduler and bind SQLAlchemy to a temporary SQLite database. High-value suites cover:

- reconciliation thresholds, ambiguity, one-to-one matching, provenance, depth policy, idempotence, and rollback;
- MPGV parsing and malformed input;
- Quakes API parameter/GeoJSON normalization;
- EPOS endpoint fallback;
- Insights limits and depth-quality policies;
- admin authentication, URL/input hardening, rate limiting, and health exemption.

Frontend tests use Vitest, jsdom, and Testing Library. They cover App request coordination, analysis transformations/export, exact filter bounds, coordinated Insights initialization, Recharts time-range behavior, the map time slider, recent selections, and MapLibre architecture/mobile layout guards.

## Recommended reading order

1. `README.md` and `DEPLOYMENT_OVERVIEW.md`
2. `backend/app.py` model declarations and public routes
3. `backend/scrape.py` and `backend/skjalftalisa_client.py`
4. `backend/reconcile.py` and `backend/tests/test_reconcile.py`
5. `frontend/src/api.js`, then `frontend/src/main.jsx`
6. `frontend/src/App.jsx`
7. `frontend/src/components/LeftPanel.jsx` and `MapComponent.jsx`
8. `frontend/src/analysis/AnalysisPage.jsx` and `analysisData.js`
9. Insights presentation components and their tests
10. `run-local.sh`, Vite configuration, security guidance, and deployment documentation

## How to trace a feature

### Trace an earthquake marker from the database to the map

1. `EarthquakeMerged` in `backend/app.py` maps `earthquake_merged`.
2. `get_earthquake_data` queries magnitude-3+ rows, optionally applies a day cutoff, enforces a row ceiling, and serializes backend field names.
3. `fetchEarthquakeData` in `frontend/src/api.js` requests `/earthquakes`.
4. `App.jsx` stores the complete array in `allData`, computes `filteredData` from date/magnitude controls, and passes it to `MapComponent`.
5. `MapComponent.jsx` normalizes coordinate/magnitude values into deck.gl data, creates hit-target and visible `ScatterplotLayer` instances, and updates selected-event state on click.
6. Selected state returns to `App.jsx`, which records recent selections and passes details back into the map/left panel.

### Trace an Insights chart from database query to rendered graph

1. `/earthquakes` supplies merged records from SQLite; `/insights/limits` separately calculates exact magnitude and policy-eligible depth bounds.
2. `App.jsx` passes `allData` to the lazy `AnalysisPage` route.
3. `AnalysisPage.jsx` calls `normalizeEarthquakes`, gets server limits, clamps/validates filters, and calls `filterEarthquakes`, `selectDepthRecords`, and `buildAnalysis`.
4. `analysisData.js` performs time aggregation, magnitude/depth histograms, category counts, scatter data, and summaries.
5. `AnalysisCharts.jsx` renders the resulting arrays with Recharts. `SummaryCards.jsx` and `ResultsTables.jsx` use the same computed source, preventing a second analytical contract.

### Trace a map filter change

1. `TimeWindowSlider.jsx` calls `onFilterChange` with normalized date boundaries, or `MagnitudeScale.jsx` calls the magnitude callback.
2. `LeftPanel.jsx` forwards those callbacks from `App.jsx`.
3. `App.jsx` updates `dateRange` or `magnitudeFilter` and recomputes `filteredData` from `allData` using `parseBackendUtcDate`.
4. React passes the new event array to `MapComponent.jsx`.
5. MapComponent rebuilds deck.gl data/layers; no new `/earthquakes` request is required for a presentation-only filter change.

### Trace an Insights filter change

1. `AnalysisFilters.jsx` maintains a draft, clamps numeric entries to catalogue bounds, validates, and submits.
2. `AnalysisPage.jsx` replaces applied filters.
3. Memoized pure functions in `analysisData.js` recalculate filtered and depth-eligible rows and build a new analysis model.
4. Charts, summaries, tables, and export context all receive that same model/selection.

### Trace deployment from the deploy script to Gunicorn and nginx

1. The separate deploy repository's `deploy.sh` installs Python/Node dependencies and builds the frontend using `/mpgv/` as the base path.
2. It stops the PID in `server.pid` and starts Gunicorn with `backend/app.py`'s `app` object on `127.0.0.1:6000`.
3. Flask serves `frontend/dist/index.html`, static asset routes, and same-origin API routes.
4. External Pluto nginx configuration proxies public `/mpgv/` requests to port 6000.
5. `/health`, `server.log`, and `server.pid` provide deployment checks.

### Trace environment variables into backend configuration

1. The shell, service environment, or ignored Pluto `private.env` exports names before Python starts.
2. `backend/app.py` reads them with `os.environ.get` while the module initializes.
3. Values configure ports, environment mode, proxy trust, query ceilings, rate limiting, admin authentication, scheduler behavior, and runtime lock location.
4. Decorators and startup functions then capture/use those settings for requests and background work.
5. Tests set safe values such as `DISABLE_SCHEDULER=1` before importing the app.

## Tightly coupled areas and refactoring candidates

### `frontend/src/components/MapComponent.jsx` (about 1,477 lines)

This file combines style transformation, external fault fetching, projection/grid helpers, MapLibre controls, deck.gl layers, markers, camera lifecycle, selection, ShakeMap lookup, and information-card rendering. Its state and layout rules also coordinate with `MapComponent.css`, `App.css`, and panel geometry. Future work could extract map-style preparation, deck.gl earthquake layers, grid/fault overlays, and event cards into separately tested modules.

### `backend/app.py` (about 864 lines)

The module owns app creation, models, schema migration, scheduler, ingestion orchestration, validation/security helpers, rate limits, every route, and SPA serving. Circular/runtime imports exist because ingestion modules import its models while scheduled functions dynamically import/reload those modules after model creation. An application factory plus `models.py`, route blueprints, and an ingestion service would reduce coupling and make startup/test behavior easier to reason about.

### `frontend/src/analysis/AnalysisPage.jsx` (about 602 lines) and `AnalysisCharts.jsx` (about 522 lines)

AnalysisPage contains substantial bilingual copy and initialization state alongside orchestration. AnalysisCharts contains several chart families, custom tooltips, scatter symbols, and time-range behavior. Extracting copy/configuration, a limits/filter hook, and chart-family modules could reduce review risk while retaining `analysisData.js` as the tested computation boundary.

### `frontend/src/components/TimeWindowSlider.jsx` (about 609 lines)

The slider combines calendar arithmetic, multiple zoom modes, wheel/pointer/touch behavior, horizontal/vertical rendering, and accessibility. Separating date-window arithmetic from interaction/rendering would improve direct unit testing.

### Shared layout CSS

Map overlay placement depends on variables declared in `App.css` and consumed by `LeftPanel.css` and `MapComponent.css`. This is intentional for coordination but creates cross-file geometry coupling; shared tokens should remain documented and guarded by layout tests.

## Relationships that static analysis cannot prove alone

- Scheduled imports are dynamic and reloaded at runtime to avoid model-definition cycles.
- React props/state relationships, lazy navigation, and callback meaning are not represented by import syntax.
- Endpoint calls must be joined from URL strings in `api.js` to Flask decorators in `app.py`.
- SQLAlchemy table access and raw `sqlite3` writes use different APIs but the same database file.
- nginx configuration and the operational `deploy.sh` live outside this main repository.
- CSS layout variables cross stylesheet boundaries without JavaScript imports.

The generator therefore records ordinary local imports automatically and keeps these cross-layer relationships as curated, source-verified edges.
