#!/usr/bin/env python3
"""Generate the MPGV Monitor architecture explorer dataset.

The generator combines deterministic static analysis with curated descriptions for
the files that carry the project's architecture. It never reads environment files,
runtime databases, generated builds, dependency folders, logs, or caches.
"""

from __future__ import annotations

import argparse
import ast
import json
import os
import re
from collections import defaultdict
from pathlib import Path


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
OUTPUT = HERE / "architecture-data.json"

SOURCE_SUFFIXES = {".py", ".js", ".jsx", ".ts", ".tsx", ".css", ".json", ".sh", ".html", ".md", ".txt"}
EXCLUDED_PARTS = {
    ".git", ".local", ".pytest_cache", "__pycache__", "node_modules", "dist",
    "venv", "runtime", "backups", "project-architecture",
}
EXCLUDED_SUFFIXES = {".db", ".sqlite", ".sqlite3", ".log", ".pid", ".pyc", ".pbf", ".png", ".csv"}


def meta(category, importance, purpose, responsibilities, why, breakage, **extra):
    return {
        "category": category,
        "importance": importance,
        "purpose": purpose,
        "responsibilities": responsibilities,
        "why": why,
        "breakage": breakage,
        **extra,
    }


MANUAL = {
    "frontend/index.html": meta("Frontend entry", "Important", "Hosts the React mount point and loads the Vite entry module.", ["Provides the #root element", "Declares page metadata", "Starts frontend/src/main.jsx through a module script"], "The browser needs a stable HTML shell before React can render either route.", "The application may fail to mount, or deployment base-path metadata may become incorrect."),
    "frontend/src/main.jsx": meta("Frontend entry", "Core", "Bootstraps React and the language context.", ["Creates the React root", "Enables StrictMode checks", "Wraps App in LangProvider"], "It is the single runtime entry point for the client application.", "Nothing in the React application will render, or translations may lose their provider."),
    "frontend/src/App.jsx": meta("Frontend orchestration", "Core", "Owns application-wide map data, persistent route state, filtering, selection state, and component composition.", ["Fetches earthquake and volcano records in parallel and refreshes every three minutes", "Filters earthquakes by date and magnitude", "Keeps Insights mounted after first use so its working state survives map navigation", "Temporarily reveals an Insights-selected event excluded by map filters", "Coordinates map, panels, dialogs, recent selections, and responsive state"], "It is the composition root that turns backend records and user actions into the two main application routes.", "Map and Insights navigation, polling, filtering, selection, or responsive behavior can break together.", communications=["GET /earthquakes", "GET /volcanoes"]),
    "frontend/src/App.css": meta("Frontend styles", "Supporting", "Defines global map-page layout, action-rail variables, title placement, and responsive behavior.", ["Positions global controls", "Defines shared map layout tokens", "Adapts the map shell below 768 px"], "Several independently rendered components share these layout variables.", "Floating controls and information cards can overlap or shift, especially on mobile."),
    "frontend/src/api.js": meta("Frontend services", "Core", "Centralizes browser-to-Flask requests and validates the Insights limits contract.", ["Selects local-development or deployed API base URL", "Fetches earthquakes, volcanoes, Insights limits, and ShakeMap matches", "Normalizes and validates limits responses", "Defines depth-quality policy identifiers"], "Components should not duplicate URL construction, cancellation, or response-contract checks.", "Both routes can lose data, target the wrong base path, or accept malformed backend responses.", communications=["GET /earthquakes", "GET /volcanoes", "GET /insights/limits", "GET /shakemap_lookup"], config=["import.meta.env.BASE_URL"]),
    "frontend/src/i18n.jsx": meta("Frontend services", "Important", "Provides English/Icelandic translation state and lookup hooks.", ["Stores the active language", "Exposes useLang and useT", "Contains map-interface translation keys"], "Map controls and information cards share one language source.", "Labels can disappear, use stale keys, or stop switching languages."),
    "frontend/src/utils/datetime.js": meta("Frontend services", "Important", "Parses backend UTC timestamp strings consistently.", ["Normalizes backend date strings", "Creates UTC Date objects without browser-local ambiguity"], "Map coloring, date filters, and Insights normalization must interpret the same timestamp identically.", "Events can be placed in the wrong period or filtered incorrectly around date boundaries."),
    "frontend/src/components/MapComponent.jsx": meta("Map frontend", "Core", "Renders the interactive MapLibre/deck.gl map and all spatial overlays.", ["Builds and patches MapLibre styles", "Renders earthquake points with deck.gl", "Renders heatmap, volcano, fault, grid, glacier-label, legend, and scale layers", "Coordinates marker selection, camera focus, map resets, and ShakeMap lookup", "Displays earthquake and volcano information cards"], "It is the spatial rendering boundary for all map modes and selected-event behavior.", "Map modes, markers, overlays, hit testing, selection, or map performance can regress.", communications=["GET /shakemap_lookup", "External EGDI/HIKE WFS", "Map tile/style providers"]),
    "frontend/src/components/MapComponent.css": meta("Frontend styles", "Supporting", "Styles map overlays, information cards, MapLibre controls, legends, and mobile map behavior.", ["Positions information cards", "Styles legends and overlays", "Adapts map controls for mobile"], "MapLibre elements and React overlays require a shared visual layer.", "Controls may overlap, become unreadable, or appear behind the map."),
    "frontend/src/components/LeftPanel.jsx": meta("Map frontend", "Important", "Renders map filters, layer switches, compact selected-event details, and the floating action rail.", ["Composes time and magnitude controls", "Changes layer and color-mode options", "Provides navigation, reset, language, About, and recent-selection actions", "Shows selected-earthquake details inside the open mobile drawer"], "It groups the main user inputs that drive App and MapComponent state.", "Users may lose filtering, layer toggles, navigation, or mobile event details."),
    "frontend/src/components/LeftPanel.css": meta("Frontend styles", "Supporting", "Defines drawer, range controls, action rail, and responsive panel presentation.", ["Positions fixed map actions", "Sizes desktop/mobile filter controls", "Styles the selected-event mobile summary"], "The left panel has complex desktop and mobile geometry.", "Filters may become inaccessible or overlap the map."),
    "frontend/src/components/TimeWindowSlider.jsx": meta("Map frontend", "Important", "Implements zoomable and draggable year, month, week, and day time-window selection.", ["Converts pointer and wheel interactions to date ranges", "Switches time resolution by zoom level", "Calls onFilterChange with normalized boundaries", "Supports horizontal and vertical layouts"], "The map needs an efficient way to navigate a multi-year catalogue.", "Date filtering can select incorrect periods or become unusable with touch input."),
    "frontend/src/components/MagnitudeScale.jsx": meta("Map frontend", "Important", "Displays magnitude encoding and provides the minimum-magnitude filter.", ["Maps magnitudes to scale positions", "Supports pointer and keyboard adjustment", "Adapts to map color ownership and layout"], "It connects the visual marker-size legend with an active catalogue filter.", "Marker interpretation and magnitude filtering can diverge."),
    "frontend/src/components/MapTypeSelector.jsx": meta("Map frontend", "Important", "Selects roadmap, dark, satellite, and heatmap modes.", ["Renders the map-mode menu", "Reports selected map type to App", "Uses translated labels"], "Map styling and layer constraints are coordinated from one explicit selection.", "Map styles may fail to switch or incompatible controls may remain enabled."),
    "frontend/src/components/RightPanel.jsx": meta("Map frontend", "Important", "Lists volcanoes and controls desktop volcano selection/visibility.", ["Sorts volcano names", "Highlights the selected volcano", "Calls App selection callbacks"], "Volcano metadata needs a browseable companion to map markers.", "Volcano browsing and marker/list selection synchronization can break."),
    "frontend/src/components/RecentSelections.jsx": meta("Map frontend", "Important", "Shows up to ten recently selected earthquakes and restores one to the map.", ["Renders earthquake history", "Clears history", "Returns a selected event to App", "Implements dialog close and Escape handling"], "Recent map investigations need a lightweight session history without persistence.", "Users can lose selection history or fail to return to an event."),
    "frontend/src/components/About.jsx": meta("Shared frontend", "Supporting", "Displays project context and backend API links in a modal dialog.", ["Provides bilingual About content", "Builds an API link from API_URL", "Manages initial focus and Escape closing"], "Both routes need project and data-source context.", "Documentation links or modal accessibility can regress."),
    "frontend/src/analysis/AnalysisPage.jsx": meta("Insights frontend", "Core", "Coordinates Insights initialization, filters, derived analysis, charts, tables, export, and map navigation.", ["Normalizes earthquake props", "Fetches policy-specific catalogue limits", "Builds and validates filter state", "Computes filtered/depth-eligible datasets and analysis results", "Composes filters, summaries, charts, tables, and CSV export"], "It is the orchestration boundary for the analytical route while App remains the source of earthquake records.", "The Insights route can show incorrect limits, stale analysis, broken exports, or unusable loading/error states.", communications=["GET /insights/limits"]),
    "frontend/src/analysis/analysisData.js": meta("Insights processing", "Core", "Contains pure normalization, validation, filtering, aggregation, histogram, and summary functions.", ["Normalizes backend rows", "Separates matched depth records from unverified MPGV depths", "Validates and clamps filter ranges", "Aggregates time series and distributions", "Builds the complete analysis model"], "Pure transformations make analytical rules testable without rendering React.", "Charts, tables, summaries, and exports may disagree or misclassify depth provenance."),
    "frontend/src/analysis/AnalysisFilters.jsx": meta("Insights frontend", "Important", "Renders and validates date, magnitude, depth-quality, depth-range, category, and grouping controls.", ["Maintains draft filter inputs", "Clamps values to catalogue bounds", "Disables unavailable depth fields", "Submits validated filters to AnalysisPage"], "Users need an explicit editable boundary between draft controls and applied analysis.", "Invalid ranges may reach analysis logic or valid catalogue extremes may become unreachable."),
    "frontend/src/analysis/AnalysisCharts.jsx": meta("Insights frontend", "Important", "Renders Recharts time, distribution, category, depth, and scatter visualizations.", ["Builds accessible chart tooltips", "Supports time-range brushing", "Distinguishes matched and unverified records", "Adapts pointer interactions for touch devices"], "The processed analysis model needs coordinated visual explanations.", "Charts may mislabel periods, hide categories, or become inaccessible on touch devices."),
    "frontend/src/analysis/SummaryCards.jsx": meta("Insights frontend", "Important", "Renders key catalogue and depth-quality summary metrics.", ["Formats counts and averages", "Explains matched versus unverified depth coverage"], "It gives fast context before detailed charts and tables.", "Headline numbers may contradict the underlying analysis."),
    "frontend/src/analysis/ResultsTables.jsx": meta("Insights frontend", "Important", "Renders paginated strongest, deepest, shallowest, and recent event tables.", ["Formats event values", "Paginates result sets", "Sends selected rows back to the map"], "Exact events complement aggregate charts and provide a path back to spatial context.", "Rows can show incorrect values or fail to focus the corresponding map marker."),
    "frontend/src/analysis/analysisExport.js": meta("Insights processing", "Important", "Builds and downloads a CSV for the active analysis selection.", ["Escapes CSV cells", "Adds filter and depth-policy metadata", "Creates and revokes the browser download URL"], "Exported data must retain enough context to interpret depth provenance and filters.", "Downloads may be malformed, ambiguous, or omit the active policy."),
    "frontend/src/analysis/ChartCard.jsx": meta("Insights frontend", "Supporting", "Provides the shared title, description, and body wrapper used by Insights charts.", ["Standardizes chart headings", "Hosts chart children"], "Charts need consistent semantic framing.", "Chart layout and accessible headings may become inconsistent."),
    "frontend/src/analysis/AnalysisPage.css": meta("Frontend styles", "Supporting", "Styles the responsive Insights route, filters, summaries, charts, tables, and loading states.", ["Defines analysis page layout", "Supports mobile filter and chart reflow", "Styles skeleton and errors"], "The analytical route has a denser layout than the map.", "Charts, filters, or tables may clip and responsive behavior may regress."),
    "backend/app.py": meta("Backend API", "Core", "Creates the Flask application, SQLAlchemy models, security/rate limits, scheduled ingestion, API routes, and built-frontend serving.", ["Defines five database models and creates/migrates tables", "Validates parameters, admin access, URLs, and response security headers", "Schedules MPGV, Quakes API, reconciliation, and volcano refresh", "Serves earthquake, volcano, Insights, CSV, ShakeMap, admin, health, and SPA routes", "Caches the default earthquake response"], "It is the backend composition root and HTTP boundary.", "API contracts, database schema, ingestion scheduling, security, or production serving can break at once.", config=["APP_ENV", "FLASK_ENV", "PORT", "BACKEND_PORT", "FRONTEND_PORT", "MAX_DAYS_WINDOW", "EARTHQUAKES_MAX_ROWS", "CSV_MAX_DAYS_WINDOW", "CSV_MAX_ROWS", "TRUSTED_PROXY_COUNT", "RATE_LIMIT_ENABLED", "RATE_LIMIT_DEFAULT", "RATE_LIMIT_STORAGE", "RATE_LIMIT_*", "ADMIN_TOKEN", "ALLOW_DEV_LOCAL_ADMIN", "RUNTIME_DIR", "DISABLE_SCHEDULER"]),
    "backend/scrape.py": meta("Data ingestion", "Core", "Scrapes MPGV monthly HTML tables and stores magnitude-3+ source records.", ["Discovers available years and months", "Parses MPGV HTML rows", "Filters invalid and low-magnitude records", "Upserts through SQLAlchemy or a standalone SQLite fallback"], "MPGV supplies the authoritative magnitude/time series used as the V source in reconciliation.", "New MPGV earthquakes may stop entering the database or duplicate rows may appear.", communications=["http://hraun.vedur.is/ja/Mpgv/", "earthquake table"]),
    "backend/skjalftalisa_client.py": meta("Data ingestion", "Core", "Fetches IMO Quakes API GeoJSON and upserts raw reference events.", ["Builds UTC query windows", "Retries Quakes API requests", "Normalizes GeoJSON coordinates and timestamps", "Upserts records by event_id", "Supports historical backfill"], "Reference locations and depths are needed to validate/enrich MPGV events.", "Matched events lose reference coordinates/depths and reconciliation produces more v_only rows.", communications=["https://api.vedur.is/quakes/events", "earthquake_s_raw table"]),
    "backend/reconcile.py": meta("Data reconciliation", "Core", "Matches MPGV and Quakes API events and atomically rebuilds the merged display table.", ["Matches within time, distance, and magnitude thresholds", "Enforces one-to-one unambiguous assignment", "Chooses depth according to DEPTH_POLICY", "Records match diagnostics and provenance", "Replaces a requested time window in one transaction"], "The frontend reads one catalogue that combines MPGV magnitude/time with better reference location/depth when a safe match exists.", "Displayed coordinates/depths and matched/v_only provenance may become incorrect or rows may be lost.", communications=["earthquake table", "earthquake_s_raw table", "earthquake_merged table"]),
    "backend/volcano_scraper.py": meta("Data ingestion", "Important", "Fetches, normalizes, validates, and transactionally replaces EPOS volcano metadata.", ["Tries current and legacy EPOS catalogue endpoints", "Normalizes response schemas", "Rejects suspiciously small or invalid datasets", "Replaces the volcano table in a transaction"], "Volcano overlays need a stable local catalogue despite upstream schema differences.", "The map may show stale/no volcanoes or unsafe replacement could erase good data.", communications=["https://api.vedur.is/epos", "volcano table"], config=["MIN_VALID_VOLCANO_ROWS"]),
    "backend/shakemap_validator.py": meta("Data validation", "Supporting", "Audits merged earthquakes against EPOS ShakeMap candidates and stores validated links.", ["Fetches ShakeMaps in an event window", "Scores time, distance, and magnitude differences", "Writes validation status and diagnostics", "Produces an audit report"], "Stored ShakeMap links can be prevalidated independently of live lookup.", "ShakeMap availability may be stale or incorrectly matched."),
    "backend/requirements.txt": meta("Configuration", "Important", "Pins the Python packages required by Flask, SQLAlchemy, scraping, scheduling, rate limiting, production serving, and tests.", ["Defines backend install inputs", "Keeps deployment and local environments reproducible"], "Backend scripts and deploy tooling install from one dependency list.", "Installs can become non-reproducible or runtime imports can fail."),
    "frontend/package.json": meta("Configuration", "Important", "Defines frontend dependencies and dev, test, lint, build, and preview scripts.", ["Declares React, MapLibre, deck.gl, Recharts, Axios, and test tooling", "Provides the frontend command interface"], "Local development, CI-like validation, and production builds share these commands.", "The frontend may not install, test, lint, or build consistently."),
    "frontend/vite.config.js": meta("Configuration", "Important", "Configures React/Vite build base path, local server, esnext target, and Vitest environment.", ["Loads VITE_BASE_PATH", "Registers the React plugin", "Sets port 5174", "Configures jsdom and test setup"], "The same toolchain serves development, builds production assets, and runs frontend tests.", "Deployments may use broken asset paths or tests may run in the wrong environment.", config=["VITE_BASE_PATH"]),
    "frontend/public/map-style.json": meta("Configuration", "Important", "Provides the local MapLibre style document and tile/font/sprite references.", ["Defines base map sources", "Defines style layers consumed and patched by MapComponent"], "The map needs a deployable style that MapComponent can adapt for roadmap rendering.", "Base tiles, labels, fonts, or sprites may disappear."),
    "run-local.sh": meta("Deployment", "Important", "Creates/uses the backend virtual environment and launches Flask plus Vite for local development.", ["Installs missing dependencies", "Starts Flask on the configured backend port", "Starts Vite on the configured frontend port", "Tracks and cleans the backend PID"], "It offers one command for the two-process local application.", "Local startup, port coordination, or shutdown cleanup can fail.", config=["BACKEND_PORT", "FRONTEND_PORT", "DISABLE_SCHEDULER", "RATE_LIMIT_ENABLED"]),
    "stop-local.sh": meta("Deployment", "Supporting", "Stops the local backend process recorded by run-local.sh.", ["Reads .local/backend.pid", "Stops a live process", "Removes the PID file"], "It cleans up a backend left running outside the foreground Vite process.", "A stale local backend may remain or the wrong PID workflow may be used."),
    "DEPLOYMENT_OVERVIEW.md": meta("Documentation", "Important", "Documents the Pluto deployment topology, update flow, runtime files, health checks, and HTTPS responsibility.", ["Records paths, port, and public base URL", "Explains deploy/restart steps", "Separates private configuration from source"], "Deployment knowledge otherwise lives outside application code.", "Future maintainers may deploy the wrong repository, path, port, or security configuration."),
    "README.md": meta("Documentation", "Important", "Introduces the project, local setup, architecture, deployment, tests, APIs, and data sources.", ["Provides the primary onboarding path", "Lists operational commands and routes", "Explains mapping and data provenance"], "It is the first reference for developers and supervisors.", "Onboarding and operations may follow outdated assumptions."),
    "SECURITY.md": meta("Documentation", "Supporting", "Documents security controls, deployment expectations, and reporting guidance.", ["Explains admin-token handling", "Documents rate limiting and proxy considerations"], "Security-sensitive operational choices need explicit guidance.", "Tokens, proxy headers, or public endpoints may be configured unsafely."),
    "backend/tests/conftest.py": meta("Backend tests", "Test", "Creates an isolated Flask application and temporary SQLite database for backend tests.", ["Disables the scheduler", "Rebinds SQLAlchemy to a temporary database", "Provides app and database fixtures"], "Backend tests must never touch the production/runtime database or start background ingestion.", "Tests may become nondeterministic or modify real data."),
    "backend/tests/test_reconcile.py": meta("Backend tests", "Test", "Covers reconciliation thresholds, ambiguity, provenance, depth policies, and idempotence.", ["Builds source fixtures", "Asserts matched/v_only decisions", "Checks diagnostic fields and transactional reruns"], "Reconciliation is the most scientifically sensitive data transformation.", "Matching regressions may reach production undetected."),
    "backend/tests/test_security_hardening.py": meta("Backend tests", "Test", "Covers admin authentication, input validation, URL validation, and transactional rollback safety.", ["Tests protected routes", "Rejects unsafe parameters and links", "Verifies failed replacements preserve prior data"], "Security and data-loss controls need executable guarantees.", "Authentication, SSRF defenses, or rollback behavior may regress silently."),
    "backend/tests/test_scrape_parse.py": meta("Backend tests", "Test", "Covers MPGV HTML parsing, magnitude filtering, timestamps, and malformed rows.", ["Mocks monthly HTML responses", "Checks accepted/rejected row shapes"], "External HTML is less stable than an API contract.", "Upstream markup changes may corrupt or halt ingestion unnoticed."),
    "backend/tests/test_skjalftalisa_client.py": meta("Backend tests", "Test", "Covers Quakes API request parameters, GeoJSON normalization, cutoff behavior, and malformed features.", ["Mocks API responses", "Checks coordinate/time conversion", "Verifies pre-cutoff requests are skipped"], "The reference-data client defines reconciliation input quality.", "Bad Quakes API records may enter the raw table."),
    "backend/tests/test_volcano_scraper.py": meta("Backend tests", "Test", "Covers current/fallback EPOS endpoints and payload normalization.", ["Mocks endpoint responses", "Checks fallback and empty behavior"], "The volcano scraper supports multiple upstream schemas.", "A schema or endpoint change may remove volcano data unnoticed."),
    "backend/tests/test_insights_limits.py": meta("Backend tests", "Test", "Covers magnitude/depth catalogue limits for both depth-quality policies.", ["Seeds merged rows", "Checks reference-only versus unverified depth bounds", "Rejects invalid query parameters"], "Frontend filters depend on exact server-side bounds.", "Insights initialization can expose invalid ranges."),
    "backend/tests/test_rate_limiting.py": meta("Backend tests", "Test", "Covers configurable endpoint rate limits and health exemption.", ["Overrides rate-limit environment names", "Exercises repeated public requests"], "Operational protections must remain configurable without blocking health checks.", "Public endpoints may become unprotected or health monitoring may be throttled."),
    "frontend/src/__tests__/AppInitialRequests.test.jsx": meta("Frontend tests", "Test", "Verifies initial request coordination and cross-route selection/state behavior.", ["Mocks API functions and route children", "Checks StrictMode stale-request protection", "Checks the 15-second filtered-event exception", "Checks Insights state survives map navigation"], "App owns asynchronous requests and the state boundary between the map and Insights.", "Stale responses, hidden selected events, or lost Insights work can reach users."),
    "frontend/src/__tests__/analysisData.test.js": meta("Frontend tests", "Test", "Covers Insights normalization, filtering, bounds, aggregation, depth provenance, validation, and CSV output.", ["Exercises pure analysis transformations", "Checks edge-case catalogue bounds", "Checks export context"], "Most analytical correctness lives in pure functions.", "Charts and exports may silently report wrong results."),
    "frontend/src/__tests__/AnalysisPageLimits.test.jsx": meta("Frontend tests", "Test", "Verifies coordinated earthquake/limit loading, error recovery, and filter initialization.", ["Mocks charts, tables, and API limits", "Checks skeleton/error states", "Checks filters mount only with valid bounds"], "Insights has two asynchronous prerequisites that must agree.", "Users may see invalid empty filters or lose retry behavior."),
    "frontend/src/__tests__/AnalysisFilters.test.jsx": meta("Frontend tests", "Test", "Covers numeric extremes, clamping, equal endpoints, and depth-policy transitions.", ["Submits filter forms", "Checks exact catalogue boundaries", "Checks unavailable-depth handling"], "Browser input behavior must match analysis validation rules.", "Valid events can be excluded or invalid filters accepted."),
    "frontend/src/__tests__/AnalysisTimeRange.test.jsx": meta("Frontend tests", "Test", "Covers chart range labels, brush state, locale, and reset behavior.", ["Mocks Recharts", "Exercises range changes", "Checks accessible labels"], "Interactive chart navigation must remain understandable across locales.", "Range labels and chart accessibility may drift."),
    "frontend/src/__tests__/TimeWindowSlider.test.jsx": meta("Frontend tests", "Test", "Covers map time-slider render, zoom modes, labels, and filter callbacks.", ["Exercises year/month mode transitions", "Checks computed date ranges"], "The custom time navigation has many boundary calculations.", "Map filtering may select unexpected date ranges."),
    "frontend/src/__tests__/RecentSelections.test.jsx": meta("Frontend tests", "Test", "Covers recent-selection details, map restoration, clearing, and Escape close.", ["Renders the dialog", "Invokes callbacks", "Checks empty state"], "The session-history dialog connects back to map selection.", "Users may not be able to restore or clear recent events."),
    "frontend/src/__tests__/MapArchitecture.test.js": meta("Frontend tests", "Test", "Guards the active MapLibre/deck.gl architecture and mobile action-rail positioning.", ["Rejects legacy Leaflet dependencies", "Checks map implementation markers", "Checks six-button rail geometry"], "Architectural regressions and a known mobile overlap need explicit protection.", "Legacy dependencies or the recent-selection overlap may return."),
}


SYSTEMS = {
    "system:sqlite": meta("Database", "Core", "Runtime SQLite catalogue at backend/data/earthquakes.db (contents intentionally excluded).", ["Stores MPGV source rows", "Stores Quakes API raw rows", "Stores merged display rows", "Stores volcanoes and validated ShakeMap links"], "One local database supports ingestion, reconciliation, API queries, and deployment health checks.", "Schema or transaction mistakes can affect every data-serving path.", node_type="system", label="SQLite catalogue", symbols=["earthquake", "earthquake_s_raw", "earthquake_merged", "volcano", "shakemap_links"]),
    "external:mpgv": meta("External source", "Important", "IMO MPGV monthly HTML catalogue.", ["Provides event time, MPGV coordinates/depth, and Mw_mean"], "It is the magnitude/time source used by the monitor.", "MPGV ingestion stops when its pages or schema change.", node_type="external", label="MPGV HTML source"),
    "external:quakes": meta("External source", "Important", "IMO Quakes API GeoJSON events endpoint.", ["Provides event IDs, reference coordinates, depths, and magnitude values"], "It supplies the reference observations used for safe reconciliation.", "Reference enrichment and matched depth analysis degrade when unavailable.", node_type="external", label="IMO Quakes API"),
    "external:epos": meta("External source", "Important", "EPOS/IMO volcano and ShakeMap APIs.", ["Provides volcano metadata", "Provides candidate ShakeMap products"], "The map augments earthquakes with volcanic context and validated ground-motion products.", "Volcano or ShakeMap features may become stale/unavailable.", node_type="external", label="EPOS APIs"),
    "runtime:browser": meta("Runtime", "Important", "Browser runtime hosting React, MapLibre, deck.gl, and Recharts.", ["Runs both application routes", "Requests Flask JSON", "Renders maps and analysis"], "It is the interactive client boundary.", "Unsupported browser APIs or asset failures stop the UI.", node_type="runtime", label="Browser"),
    "runtime:flask": meta("Runtime", "Important", "Flask/Gunicorn HTTP service behind the Pluto /mpgv/ proxy.", ["Serves built frontend assets", "Exposes JSON/admin routes", "Runs scheduled ingestion"], "One same-origin service simplifies deployment and API access.", "The public application and APIs become unavailable.", node_type="runtime", label="Flask / Gunicorn"),
}


CURATED_EDGES = [
    ("runtime:browser", "frontend/index.html", "Loads", "The browser requests the HTML shell before any React module runs."),
    ("frontend/index.html", "frontend/src/main.jsx", "Script execution", "The module script loads the React entry point."),
    ("frontend/src/main.jsx", "frontend/src/App.jsx", "Component rendering", "main.jsx renders App inside StrictMode and LangProvider."),
    ("frontend/src/App.jsx", "frontend/src/components/MapComponent.jsx", "Component rendering", "App passes filtered events, layer state, selections, and map callbacks to MapComponent."),
    ("frontend/src/App.jsx", "frontend/src/components/LeftPanel.jsx", "Shared state / props", "LeftPanel edits the date, magnitude, layer, language, navigation, and panel state owned by App."),
    ("frontend/src/App.jsx", "frontend/src/components/RightPanel.jsx", "Shared state / props", "App shares volcano visibility and selection with the desktop list."),
    ("frontend/src/App.jsx", "frontend/src/components/RecentSelections.jsx", "Component rendering", "App owns the selection history and lets the dialog refocus a stored event."),
    ("frontend/src/App.jsx", "frontend/src/analysis/AnalysisPage.jsx", "Navigation between pages", "App lazy-loads the Insights route and passes the already-fetched earthquake catalogue."),
    ("frontend/src/App.jsx", "frontend/src/api.js", "Function calls", "App calls centralized earthquake and volcano request helpers during polling."),
    ("frontend/src/api.js", "backend/app.py", "API request", "API helpers call Flask earthquake, volcano, limits, and ShakeMap endpoints using the deployed base path."),
    ("frontend/src/components/MapComponent.jsx", "frontend/src/api.js", "API request", "A selected earthquake triggers fetchShakeMapValidated for a nearby live ShakeMap."),
    ("frontend/src/components/MapComponent.jsx", "frontend/public/map-style.json", "Configuration loading", "Roadmap mode loads and patches the local MapLibre style document."),
    ("frontend/src/analysis/AnalysisPage.jsx", "frontend/src/analysis/analysisData.js", "Function calls", "AnalysisPage normalizes, filters, validates, and aggregates records through pure analysis helpers."),
    ("frontend/src/analysis/AnalysisPage.jsx", "frontend/src/analysis/AnalysisCharts.jsx", "Component rendering", "The page passes the computed analysis model to Recharts visualizations."),
    ("frontend/src/analysis/AnalysisPage.jsx", "frontend/src/analysis/AnalysisFilters.jsx", "Shared state / props", "Draft/applied filters and catalogue bounds flow between the page and filter form."),
    ("frontend/src/analysis/AnalysisPage.jsx", "frontend/src/analysis/ResultsTables.jsx", "Component rendering", "Filtered strongest/deepest/recent rows are rendered with map-navigation callbacks."),
    ("frontend/src/analysis/AnalysisPage.jsx", "frontend/src/analysis/SummaryCards.jsx", "Component rendering", "Summary metrics are rendered from the same computed analysis model."),
    ("frontend/src/analysis/AnalysisPage.jsx", "frontend/src/analysis/analysisExport.js", "Generated output", "The page exports the active filtered rows and policy metadata as CSV."),
    ("frontend/src/analysis/AnalysisPage.jsx", "frontend/src/api.js", "API request", "The page fetches server-calculated magnitude and depth limits for the selected depth policy."),
    ("backend/app.py", "system:sqlite", "Database access", "SQLAlchemy models query and update all five runtime tables."),
    ("backend/app.py", "backend/scrape.py", "Script execution", "The scheduler and protected initialization invoke MPGV scraping."),
    ("backend/app.py", "backend/skjalftalisa_client.py", "Data ingestion flow", "The scheduler fetches and stores the latest seven days of Quakes API events."),
    ("backend/app.py", "backend/reconcile.py", "Data reconciliation flow", "Scheduled and admin workflows rebuild merged events after source ingestion."),
    ("backend/app.py", "backend/volcano_scraper.py", "Data ingestion flow", "Scheduled and protected workflows refresh the volcano table."),
    ("backend/scrape.py", "external:mpgv", "Data ingestion flow", "The scraper downloads year/month HTML pages and parses earthquake rows."),
    ("backend/scrape.py", "system:sqlite", "Database access", "Parsed MPGV events are inserted into the earthquake source table."),
    ("backend/skjalftalisa_client.py", "external:quakes", "Data ingestion flow", "The client requests GeoJSON events for a UTC time window."),
    ("backend/skjalftalisa_client.py", "system:sqlite", "Database access", "Normalized reference events are upserted into earthquake_s_raw by event_id."),
    ("backend/reconcile.py", "system:sqlite", "Data reconciliation flow", "The reconciler reads both source tables and atomically replaces earthquake_merged rows."),
    ("backend/volcano_scraper.py", "external:epos", "Data ingestion flow", "The scraper tries current and fallback EPOS volcano endpoints."),
    ("backend/volcano_scraper.py", "system:sqlite", "Database access", "A validated volcano snapshot replaces the volcano table transactionally."),
    ("backend/app.py", "external:epos", "API request", "The live ShakeMap lookup fetches candidates and validates the returned view URL."),
    ("backend/app.py", "runtime:flask", "Deployment dependency", "Gunicorn imports app:app and serves its routes."),
    ("runtime:flask", "runtime:browser", "API response", "Flask serves the SPA and same-origin JSON responses under the deployment base path."),
    ("run-local.sh", "backend/app.py", "Script execution", "The local launcher starts the Flask backend with scheduler/rate-limit development settings."),
    ("run-local.sh", "frontend/package.json", "Script execution", "The launcher runs the Vite dev script on port 5174."),
    ("frontend/package.json", "frontend/vite.config.js", "Configuration loading", "Vite and Vitest commands load their shared configuration."),
    ("frontend/vite.config.js", "frontend/src/main.jsx", "Generated output", "Vite bundles the React entry and its dependency graph into frontend/dist."),
    ("DEPLOYMENT_OVERVIEW.md", "runtime:flask", "Deployment dependency", "The deployment guide records how the built frontend and Gunicorn service are exposed on Pluto."),
]


FLOWS = [
    {"id": "ingestion", "name": "Earthquake ingestion", "steps": ["external:mpgv", "backend/scrape.py", "system:sqlite", "backend/skjalftalisa_client.py", "backend/reconcile.py", "backend/app.py", "frontend/src/api.js", "frontend/src/App.jsx", "frontend/src/components/MapComponent.jsx"], "note": "MPGV rows and Quakes API reference rows enter separate tables; reconciliation creates the catalogue served to the map."},
    {"id": "map", "name": "Map interaction", "steps": ["frontend/src/components/LeftPanel.jsx", "frontend/src/App.jsx", "frontend/src/components/MapComponent.jsx", "frontend/src/api.js", "backend/app.py", "external:epos"], "note": "Panel actions update App state; MapComponent redraws local layers and only calls Flask when a selected event needs ShakeMap lookup."},
    {"id": "insights", "name": "Insights analysis", "steps": ["frontend/src/analysis/AnalysisFilters.jsx", "frontend/src/analysis/AnalysisPage.jsx", "frontend/src/api.js", "backend/app.py", "system:sqlite", "frontend/src/analysis/analysisData.js", "frontend/src/analysis/AnalysisCharts.jsx", "frontend/src/analysis/ResultsTables.jsx"], "note": "Limits come from SQLite through Flask, while record filtering, aggregation, charting, and tables run in the browser over App's catalogue."},
    {"id": "database", "name": "Database and reconciliation", "steps": ["backend/scrape.py", "backend/skjalftalisa_client.py", "system:sqlite", "backend/reconcile.py", "system:sqlite", "backend/app.py"], "note": "Two source tables remain auditable; a transactional replacement produces the merged display table and provenance diagnostics."},
    {"id": "deployment", "name": "Local/deployment path", "steps": ["run-local.sh", "frontend/package.json", "frontend/vite.config.js", "frontend/src/main.jsx", "backend/app.py", "runtime:flask", "runtime:browser"], "note": "Local development runs Vite and Flask separately; production builds the frontend and lets Flask/Gunicorn serve it from one origin."},
]


VIEWS = [
    {"id": "full", "name": "Full project overview", "categories": []},
    {"id": "frontend", "name": "Frontend architecture", "categories": ["Frontend entry", "Frontend orchestration", "Frontend services", "Shared frontend", "Map frontend", "Insights frontend", "Insights processing", "Frontend styles", "Runtime"]},
    {"id": "backend", "name": "Backend architecture", "categories": ["Backend API", "Data ingestion", "Data reconciliation", "Data validation", "Database", "External source", "Runtime"]},
    {"id": "ingestion", "name": "Data ingestion and reconciliation", "node_ids": ["backend/app.py", "backend/scrape.py", "backend/skjalftalisa_client.py", "backend/reconcile.py", "backend/volcano_scraper.py", "system:sqlite", "external:mpgv", "external:quakes", "external:epos"]},
    {"id": "insights", "name": "Insights / Analysis page flow", "node_ids": ["frontend/src/App.jsx", "frontend/src/api.js", "frontend/src/analysis/AnalysisPage.jsx", "frontend/src/analysis/analysisData.js", "frontend/src/analysis/AnalysisFilters.jsx", "frontend/src/analysis/AnalysisCharts.jsx", "frontend/src/analysis/SummaryCards.jsx", "frontend/src/analysis/ResultsTables.jsx", "frontend/src/analysis/analysisExport.js", "backend/app.py", "system:sqlite"]},
    {"id": "map", "name": "Map page flow", "node_ids": ["frontend/src/App.jsx", "frontend/src/api.js", "frontend/src/i18n.jsx", "frontend/src/utils/datetime.js", "frontend/src/components/MapComponent.jsx", "frontend/src/components/LeftPanel.jsx", "frontend/src/components/TimeWindowSlider.jsx", "frontend/src/components/MagnitudeScale.jsx", "frontend/src/components/MapTypeSelector.jsx", "frontend/src/components/RightPanel.jsx", "frontend/src/components/RecentSelections.jsx", "frontend/public/map-style.json", "backend/app.py", "external:epos"]},
    {"id": "database", "name": "Database flow", "node_ids": ["system:sqlite", "backend/app.py", "backend/scrape.py", "backend/skjalftalisa_client.py", "backend/reconcile.py", "backend/volcano_scraper.py", "backend/shakemap_validator.py"]},
    {"id": "deployment", "name": "Deployment and configuration", "categories": ["Deployment", "Configuration", "Documentation", "Runtime", "Frontend entry", "Backend API"]},
    {"id": "testing", "name": "Testing relationships", "categories": ["Backend tests", "Frontend tests", "Backend API", "Data ingestion", "Data reconciliation", "Map frontend", "Insights frontend", "Insights processing", "Frontend orchestration"]},
]


def repo_files():
    result = []
    for directory, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = sorted(
            name for name in dirnames
            if name not in EXCLUDED_PARTS and name not in {"fonts", "sprites", "assets"}
        )
        directory_path = Path(directory)
        for filename in sorted(filenames):
            if filename in {"package-lock.json"}:
                continue
            path = directory_path / filename
            rel = path.relative_to(ROOT)
            if path.suffix.lower() in EXCLUDED_SUFFIXES:
                continue
            if path.suffix.lower() not in SOURCE_SUFFIXES and path.name not in {"requirements.txt"}:
                continue
            result.append(rel.as_posix())
    return sorted(result)


def read_text(rel):
    return (ROOT / rel).read_text(encoding="utf-8", errors="replace")


def resolve_js_import(source, specifier, known):
    if not specifier.startswith("."):
        return None
    try:
        base = (ROOT / Path(source).parent / specifier).resolve().relative_to(ROOT).as_posix()
    except ValueError:
        return None
    candidates = [base, *(base + ext for ext in (".js", ".jsx", ".ts", ".tsx", ".css", ".json"))]
    candidates += [f"{base}/index{ext}" for ext in (".js", ".jsx", ".ts", ".tsx")]
    return next((candidate for candidate in candidates if candidate in known), None)


def analyse_file(rel, known):
    text = read_text(rel)
    info = {"lines": text.count("\n") + 1, "imports": [], "symbols": [], "routes": [], "env": []}
    suffix = Path(rel).suffix.lower()
    if suffix == ".py":
        try:
            tree = ast.parse(text)
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and not node.name.startswith("_"):
                    info["symbols"].append(node.name)
                elif isinstance(node, ast.ImportFrom) and node.module:
                    candidate = f"backend/{node.module.replace('.', '/')}.py"
                    if candidate in known:
                        info["imports"].append(candidate)
                elif isinstance(node, ast.Import):
                    for alias in node.names:
                        candidate = f"backend/{alias.name.replace('.', '/')}.py"
                        if candidate in known:
                            info["imports"].append(candidate)
        except SyntaxError:
            pass
        info["routes"] = re.findall(r"@app\.route\(\s*['\"]([^'\"]+)", text)
        info["env"] = re.findall(r"(?:os\.environ\.get|os\.getenv)\(\s*['\"]([A-Z][A-Z0-9_]*)", text)
    elif suffix in {".js", ".jsx", ".ts", ".tsx"}:
        specs = re.findall(r"(?:import[\s\S]*?from\s*|import\s*)['\"]([^'\"]+)['\"]", text)
        for spec in specs:
            resolved = resolve_js_import(rel, spec, known)
            if resolved:
                info["imports"].append(resolved)
        info["symbols"] = re.findall(r"(?:export\s+)?(?:const|function|class)\s+([A-Za-z_$][\w$]*)", text)
        info["env"] = re.findall(r"import\.meta\.env\.([A-Z][A-Z0-9_]*)", text)
    elif suffix == ".sh":
        info["env"] = re.findall(r"\$\{([A-Z][A-Z0-9_]*)(?::-[^}]*)?\}", text)
    info["imports"] = sorted(set(info["imports"]))
    info["symbols"] = sorted(set(info["symbols"]))[:24]
    info["routes"] = sorted(set(info["routes"]))
    info["env"] = sorted(set(info["env"]))
    return info


def label_for(node_id, metadata):
    if metadata.get("label"):
        return metadata["label"]
    path = Path(node_id)
    return path.name


def build():
    files = repo_files()
    known = set(files)
    missing = sorted(path for path in MANUAL if path not in known)
    if missing:
        raise SystemExit("Curated paths missing from repository: " + ", ".join(missing))

    analyses = {rel: analyse_file(rel, known) for rel in files}
    nodes = []
    for node_id, metadata in {**MANUAL, **SYSTEMS}.items():
        analysis = analyses.get(node_id, {"lines": None, "imports": [], "symbols": [], "routes": [], "env": []})
        merged = dict(metadata)
        merged["id"] = node_id
        merged["path"] = node_id if metadata.get("node_type", "file") == "file" else "Runtime / external system"
        merged["node_type"] = metadata.get("node_type", "file")
        merged["label"] = label_for(node_id, metadata)
        merged["lines"] = analysis["lines"]
        merged["imports"] = analysis["imports"]
        merged["symbols"] = sorted(set(metadata.get("symbols", [])) | set(analysis["symbols"]))
        merged["routes"] = analysis["routes"]
        merged["config"] = sorted(set(metadata.get("config", [])) | set(analysis["env"]))
        merged.setdefault("communications", [])
        nodes.append(merged)

    node_ids = {node["id"] for node in nodes}
    edges = []
    seen = set()

    def add_edge(source, target, rel_type, reason, detected):
        if source not in node_ids or target not in node_ids or source == target:
            return
        key = (source, target)
        if key in seen:
            if not detected:
                existing = next(edge for edge in edges if edge["source"] == source and edge["target"] == target)
                if existing["detected"]:
                    existing.update({"type": rel_type, "reason": reason, "detected": False})
            return
        seen.add(key)
        edges.append({"id": f"e{len(edges) + 1}", "source": source, "target": target, "type": rel_type, "reason": reason, "detected": detected})

    for source, analysis in analyses.items():
        if source not in node_ids:
            continue
        for target in analysis["imports"]:
            if target in node_ids:
                rel_type = "Stylesheet usage" if target.endswith(".css") else "Imports"
                add_edge(source, target, rel_type, f"{source} imports {target} to use its exported code or styles.", True)

    for source, target, rel_type, reason in CURATED_EDGES:
        add_edge(source, target, rel_type, reason, False)

    # Test imports are more useful when described explicitly as coverage.
    for edge in list(edges):
        source_node = next(node for node in nodes if node["id"] == edge["source"])
        if source_node["importance"] == "Test" and edge["type"] == "Imports":
            edge["type"] = "Test coverage"
            edge["reason"] = f"{edge['source']} imports and exercises behavior from {edge['target']}."

    outgoing = defaultdict(list)
    incoming = defaultdict(list)
    for edge in edges:
        outgoing[edge["source"]].append(edge["target"])
        incoming[edge["target"]].append(edge["source"])
    for node in nodes:
        node["dependencies"] = sorted(set(outgoing[node["id"]]))
        node["dependents"] = sorted(set(incoming[node["id"]]))
        node["tests"] = sorted(source for source in node["dependents"] if next(n for n in nodes if n["id"] == source)["importance"] == "Test")

    nodes.sort(key=lambda node: (node["category"], node["importance"], node["id"]))
    edges.sort(key=lambda edge: (edge["source"], edge["target"], edge["type"]))
    for index, edge in enumerate(edges, 1):
        edge["id"] = f"e{index}"

    important_count = sum(node["node_type"] == "file" and node["importance"] in {"Core", "Important"} for node in nodes)
    large_files = sorted(
        ({"path": rel, "lines": info["lines"]} for rel, info in analyses.items() if info["lines"] >= 300),
        key=lambda item: (-item["lines"], item["path"]),
    )
    payload = {
        "project": {
            "name": "MPGV Monitor",
            "generated_by": "project-architecture/generate_architecture.py",
            "analysed_files": len(files),
            "displayed_nodes": len(nodes),
            "displayed_important_files": important_count,
            "relationships": len(edges),
            "entry_points": ["frontend/index.html", "frontend/src/main.jsx", "frontend/src/App.jsx", "backend/app.py", "run-local.sh"],
            "large_files": large_files[:12],
            "excluded": ["node_modules", "virtual environments", "frontend/dist", "runtime databases and journals", "logs and PID files", "font/sprite binaries", ".git", "caches", "architecture explorer output"],
            "limitations": ["Dynamic Python imports inside scheduled jobs are curated because AST import analysis cannot resolve runtime reloads.", "HTTP endpoint relationships are curated from concrete URL strings and Flask route decorators.", "Prop/state semantics and Recharts/MapLibre rendering relationships require curated explanations beyond import detection.", "nginx configuration is documented but not stored in this repository, so it is represented only through deployment documentation and runtime nodes."],
        },
        "categories": sorted({node["category"] for node in nodes}),
        "views": VIEWS,
        "flows": FLOWS,
        "nodes": nodes,
        "edges": edges,
    }
    return payload


def validate(payload):
    ids = {node["id"] for node in payload["nodes"]}
    errors = []
    for node in payload["nodes"]:
        if node["node_type"] == "file" and not (ROOT / node["id"]).is_file():
            errors.append(f"missing file node: {node['id']}")
    for edge in payload["edges"]:
        if edge["source"] not in ids or edge["target"] not in ids:
            errors.append(f"invalid edge: {edge['id']}")
    for view in payload["views"]:
        for node_id in view.get("node_ids", []):
            if node_id not in ids:
                errors.append(f"invalid view node: {view['id']} -> {node_id}")
    for flow in payload["flows"]:
        for node_id in flow["steps"]:
            if node_id not in ids:
                errors.append(f"invalid flow node: {flow['id']} -> {node_id}")
    serialized = json.dumps(payload)
    secret_patterns = [r"ghp_[A-Za-z0-9]{20,}", r"sk-[A-Za-z0-9_-]{20,}", r"ADMIN_TOKEN\s*=\s*[^,}\s]+"]
    for pattern in secret_patterns:
        if re.search(pattern, serialized):
            errors.append("possible private value detected")
    if errors:
        raise SystemExit("Validation failed:\n- " + "\n- ".join(errors))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Validate that regeneration matches architecture-data.json")
    args = parser.parse_args()
    payload = build()
    validate(payload)
    rendered = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text(encoding="utf-8") != rendered:
            raise SystemExit("architecture-data.json is stale; run generate_architecture.py")
        print(f"OK: {payload['project']['analysed_files']} files, {len(payload['nodes'])} nodes, {len(payload['edges'])} relationships")
        return
    OUTPUT.write_text(rendered, encoding="utf-8")
    print(f"Generated {OUTPUT.relative_to(ROOT)}")
    print(f"Analysed files: {payload['project']['analysed_files']}")
    print(f"Displayed nodes: {len(payload['nodes'])}")
    print(f"Relationships: {len(payload['edges'])}")


if __name__ == "__main__":
    main()
