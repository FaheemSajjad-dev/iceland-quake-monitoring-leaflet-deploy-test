# MPGV Monitor Backend

Flask, SQLAlchemy, SQLite, and APScheduler backend for MPGV Monitor. It ingests MPGV and IMO data, reconciles earthquake records, refreshes volcano metadata, serves the map and Insights catalogue APIs, and serves the built React frontend in production.

## Local setup

The preferred full-stack command is run from the repository root:

```bash
npm run dev
```

That script creates `backend/venv` when needed, installs `backend/requirements.txt`, starts Flask on `http://127.0.0.1:5001`, and disables scheduled ingestion by default. To run the three-minute background refresh locally:

```bash
DISABLE_SCHEDULER=0 npm run dev
```

For backend-only use, activate a Python virtual environment, install `requirements.txt`, and run `python app.py`. Configuration is read from environment variables; `.env` files are reference material and are not loaded automatically by `app.py`.

## Data model and ingestion

SQLite data is stored in `backend/data/earthquakes.db` by default. SQLAlchemy models hold MPGV source rows, IMO Quakes API rows, the reconciled catalogue, volcano metadata, and validated ShakeMap links. SQLite uses WAL mode because API reads and the scheduler can overlap with ingestion writes.

The scheduler runs every three minutes unless `DISABLE_SCHEDULER` is set. It refreshes MPGV records, recent IMO Quakes API data, the one-to-one reconciled catalogue, and EPOS volcano metadata. Public catalogue responses include reconciled events at **M >= 3.0**.

Matched catalogue rows use MPGV time and magnitude with IMO Quakes API location and depth. MPGV rows without a unique winning match remain `v_only`; their raw depths are retained and treated as unverified by Insights unless the user explicitly includes them.

## API

| Method and route | Purpose |
|---|---|
| `GET /earthquakes` | Merged earthquake catalogue; optional bounded `days` query |
| `GET /insights/limits` | Catalogue magnitude bounds and depth bounds for `reference_only` or `include_unverified` |
| `GET /earthquakes_csv` | Server-side catalogue CSV; optional bounded `days` query |
| `GET /volcanoes` | Stored EPOS volcano metadata |
| `GET /shakemap_lookup` | On-demand ShakeMap search for one event |
| `GET /shakemap/<dt>` | Previously validated ShakeMap link status |
| `GET /health` | Row-count health response; exempt from rate limiting |
| `POST /reconcile` | Authenticated reconciliation maintenance action |
| `POST /scrape-volcanoes` | Authenticated volcano refresh action |
| `POST /initialize-data` | Authenticated explicit initialization for an empty database |

`GET /insights/limits` accepts only `depth_quality=reference_only` or `depth_quality=include_unverified`. It derives values from the current M >= 3.0 merged catalogue; it does not accept client-supplied magnitude bounds.

Production maintenance requests require `X-Admin-Token`. The legacy `GET /scrape-volcanoes` form returns 405. See the root `SECURITY.md`, `RATE_LIMITING.md`, and `.env.example` for authorization, proxy, bounds, and rate-limit configuration.

## Tests

From `backend/`:

```bash
python -m pytest tests/ -v
```

The suite covers reconciliation, parsing, Insights limits, authorization, proxy handling, rate limiting, ShakeMap behavior, volcano ingestion, and health/security responses. The live volcano test depends on an external service and may be skipped when live access is unavailable.

## Production

On Pluto, Gunicorn binds to `127.0.0.1:6000`; nginx exposes the application under `/mpgv/`. Flask serves `frontend/dist` and its route fallback supports both the map and `/mpgv/analysis`. Public TLS, Host validation, and reverse-proxy routing belong to nginx. Use `../deploy.sh` from the server project root as documented in `DEPLOYMENT_OVERVIEW.md`.
