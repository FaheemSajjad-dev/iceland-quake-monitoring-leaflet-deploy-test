# MPGV Monitor Stress Test Plan

## Goal

Measure how the application behaves under concurrent public use, including map interaction, earthquake catalogue reads, layer toggles, and CSV downloads.

## Test Scope

| Area | What to observe |
|---|---|
| Frontend responsiveness | Map pan/zoom, slider movement, overlay toggles, info-card opening, Insights filtering and charts |
| Backend API | `/earthquakes`, `/insights/limits`, `/volcanoes`, `/shakemap_lookup`, `/earthquakes_csv`, `/health` |
| Scheduler impact | Scrape/reconcile job timing, SQLite lock behavior, CPU and memory use |
| External services | Map tile latency, EGDI/HIKE fault WFS first-load time, EPOS/IMO response behavior |

## Current App Behavior Relevant To Testing

- Earthquakes and volcanoes refresh every 3 minutes.
- Fault and fissure linework is fetched on first use, filtered to Iceland/onshore records, and cached in memory for later toggles.
- Earthquake markers use deck.gl scatterplot layers with separate invisible hit targets for easier selection.
- The MapLibre Heatmap is density-first and uses weights of 0.20/0.30/0.45 by magnitude band.
- The bottom-right attribution is compact and changes with the active basemap and faults overlay.
- Flask-Limiter applies per-client limits to public API/export endpoints; expect HTTP 429 when deliberate load tests exceed configured limits.
- Insights uses the loaded merged catalogue plus policy-specific `/insights/limits` responses. Its two tables show five rows per page, and its exports are client-side filtered CSV or browser print/PDF.

## Local Verification Before Load Testing

Run these checks before testing a deployment:

```bash
cd frontend
npm audit --audit-level=low
npm run lint
npm run build
npm test

cd ../backend
python -m pytest tests/ -v
```

## Human Interaction Test

Ask testers to use the app for 3 to 5 minutes while repeating these actions:

- Pan and zoom around Iceland.
- Move the time-window slider across years, months, weeks, and days.
- Change the magnitude filter.
- Toggle volcanoes, grid, faults, and Heatmap.
- Open earthquake and volcano info cards.
- Open Recent Selections and return to a recorded earthquake.
- Try a ShakeMap lookup on eligible earthquake cards.
- Export CSV once per tester group, not repeatedly.
- Open Insights, change each filter type, move both time-chart brushes, inspect desktop or touch tooltips, paginate both tables, and return an event to the map.

Collect:

- Browser and device type.
- Whether markers, tiles, faults, or volcanoes failed to display.
- Whether the map froze, lagged, or recovered slowly after toggles.
- Any visible console/network errors.

## Backend Load Test Examples

Run from a development machine or controlled test host, not from student browsers:

```bash
# Moderate read load
ab -n 200 -c 20 http://HOST/earthquakes

# Higher read concurrency
ab -n 1000 -c 100 http://HOST/earthquakes

# Volcano endpoint
ab -n 200 -c 20 http://HOST/volcanoes

# Insights limits endpoint
ab -n 200 -c 20 'http://HOST/insights/limits?depth_quality=reference_only'

# Health endpoint
ab -n 200 -c 20 http://HOST/health
```

Avoid repeatedly load-testing manual maintenance endpoints such as `/reconcile` or `/scrape-volcanoes`; they are intended for localhost/server-side maintenance only.

## Acceptance Signals

| Signal | Target |
|---|---|
| API error rate | 0 percent for normal read endpoints during moderate load |
| UI recovery | Map remains usable after layer toggles and timeline changes |
| Fault overlay | First load may wait on WFS; later toggles should render from cache |
| Backend stability | No SQLite lock storms, scheduler crashes, or sustained memory growth |
| External services | Tile/WFS failures degrade gracefully and do not break the whole app |
