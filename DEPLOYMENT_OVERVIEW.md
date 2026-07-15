# Deployment Overview

This document records how this project is deployed, how the live service behaves, and how to monitor it.

## Current Live Deployment

- Platform: University server on Pluto
- Live URL: `http://pluto.cs.hi.is/mpgv/`
- SSH host: `pluto.cs.hi.is`
- SSH user: `mfs7`
- Server project path: `~/iceland-quake`
- Backend port: `6000`
- Source repo: `FaheemSajjad-dev/iceland-quake-monitoring-leaflet-deploy-test`

The deploy project at `F:\iceland-quake-monitoring-leaflet-deploy-test` is the local source used for Pluto uploads.

## Pluto Deployment Model

- Flask backend runs from `backend/app.py`.
- React frontend is built from `frontend/`.
- Flask serves the built frontend from `frontend/dist`.
- API and frontend are served from the same origin under `http://pluto.cs.hi.is/mpgv/`.
- Gunicorn listens locally on port `6000`; Pluto routes `/mpgv/` traffic to that backend.
- `deploy.sh` installs dependencies, builds the frontend, stops the existing Gunicorn process, and starts Gunicorn on port 6000.
- `deploy.sh` defaults to the Pluto public base path `/mpgv/` and accepts `--port` and `--base-url` for other hosting paths.
- `stop.sh` stops the running server using `server.pid`.

## Standard Update Flow

1. Apply and verify changes in the main F project.
2. Copy the same relevant changes to the deploy F project.
3. Mirror changed files to the G recovery folders.
4. Run backend and frontend tests locally.
5. Build both frontends locally.
6. Commit and push both F repositories.
7. Upload changed deploy files to Pluto.
8. On Pluto:

```bash
cd ~/iceland-quake
./deploy.sh
```

Equivalent explicit Pluto command:

```bash
./deploy.sh --port 6000 --base-url /mpgv/
```

Private Pluto configuration should live in an ignored project-owned file such as `~/iceland-quake/private.env` with mode `600`. Required production values include `APP_ENV=production`, a long random `ADMIN_TOKEN`, and `TRUSTED_PROXY_COUNT=1` only after the nginx proxy topology has been confirmed. Do not place real tokens in Git or frontend build variables.

For a fresh empty database, run initialization explicitly after deployment:

```bash
set -a
. ./private.env
set +a
curl -X POST -H "X-Admin-Token: $ADMIN_TOKEN" http://127.0.0.1:6000/initialize-data
```

Use `--base-url /` only when serving the app from a domain root. If a full public URL is supplied, such as `https://example.org/mpgv/`, the script normalizes it to the frontend base path.

When root-level deploy files change, upload only the root files that changed. When frontend or backend files change, upload the matching frontend/backend files or directories while excluding `node_modules`.

## Pluto Runtime Files

- `server.pid` stores the running Gunicorn PID.
- `server.log` stores runtime logs.
- `deploy.sh` restarts the app.
- `stop.sh` stops the app.
- `backend/venv` is created on the server and should not be copied between machines.
- `frontend/node_modules` and `frontend/dist` are generated on the server by `deploy.sh` and should not be copied as source artifacts.

## Health Checks

Check:

- `http://pluto.cs.hi.is/mpgv/`
- `http://pluto.cs.hi.is/mpgv/health` if routed by the server configuration
- `~/iceland-quake/server.log` on Pluto

## HTTPS Responsibility

Pluto nginx currently exposes this route on port 80 only. The application and Gunicorn do not terminate TLS. Enabling public HTTPS requires the Pluto server administrator to install or assign a certificate, add an nginx port 443 listener that proxies `/mpgv/` to `127.0.0.1:6000`, and redirect HTTP to HTTPS. No Flask or React protocol change is required.

## Production Considerations

- The app uses SQLite; consider PostgreSQL for true high-concurrency production use.
- Review tile-provider licensing before formal public or institutional deployment.
- Consider nginx/static caching for built assets, tiles, sprites, and fonts.
- Use shared rate-limit storage and proxy-level limits if deployment expands beyond one Gunicorn process.
- MapLibre GL requires browser WebGL support for the vector Map layer.
