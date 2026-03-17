# Deployment Overview

This document records how this project was deployed, how the live service behaves, and how to monitor it.

## Live deployment

- Platform: Render
- Service type: single `Web Service` created from `render.yaml`
- Live URL: `https://iceland-quake-monitoring-leaflet-deploy.onrender.com`
- Source repo: `FaheemSajjad-dev/iceland-quake-monitoring-leaflet-deploy-test`

## Deployment model

This deployment uses one Render service for both backend and frontend:

- Flask backend runs from `backend/app.py`
- React frontend is built from `frontend/`
- Flask serves the built frontend from `frontend/dist`
- API and frontend are served from the same origin in production

This avoids CORS and split-host complexity for testing.

## Render configuration

Render reads configuration from `render.yaml`.

- Build command:
  - `pip install -r backend/requirements-render.txt`
  - `npm ci --prefix frontend`
  - `npm run build --prefix frontend`
- Start command:
  - `gunicorn --chdir backend app:app --bind 0.0.0.0:$PORT --workers 1`
- Health check path:
  - `/health`

## How we deployed it

1. Prepared the repo for a single-service deployment.
2. Added frontend static serving to the Flask app.
3. Added `render.yaml` for Blueprint deployment.
4. Pushed the project to a new GitHub repo.
5. In Render, created a new Blueprint service from the GitHub repo.
6. Let Render build and deploy the app from `main`.

## Production behavior

### Frontend and backend

- The frontend is built during Render deploys.
- Flask serves the built SPA and also serves the API.
- Production frontend requests use the same origin.

### Background services

- APScheduler runs inside the deployed backend process.
- The app periodically scrapes earthquake data and refreshes derived data.

### Data bootstrap

Because Render free does not provide persistent disk storage, the SQLite database can be reset after:

- redeploys
- restarts
- free-tier service sleep/wake cycles

To handle that, the backend includes bootstrap behavior:

- If merged earthquake data is missing, the app rebuilds it.
- If base MPGV earthquake data is missing, the app scrapes it again.
- Volcano data is also refreshed when missing.

This means the first request after a fresh deploy may be slower while data is repopulated.

## Known free-tier limitations

- Render free services spin down after inactivity.
- The first request after sleep can be slow.
- SQLite data is not durable on free web services.
- Performance and availability are suitable for testing, not robust production hosting.

## Analytics

Cloudflare Web Analytics was added to the frontend.

### How it is enabled

- Frontend support is implemented in `frontend/src/main.jsx`
- CSP allows the Cloudflare beacon in `frontend/index.html`
- Render environment variable used:
  - `VITE_CLOUDFLARE_ANALYTICS_TOKEN`

Do not store the actual token in the repository.

### What can be monitored

In Cloudflare Web Analytics, monitor:

- visits
- page views
- countries
- browsers
- page load time
- Core Web Vitals
  - LCP
  - INP
  - CLS

## Performance

At the time of setup, the deployed site showed:

- page load time around `887 ms`
- `LCP` rated `Good`
- `INP` rated `Good`
- `CLS` rated `Good`

This indicates the testing deployment was performing well at that point in time. These numbers can vary depending on traffic, cold starts, and client network conditions.

## Monitoring

### Render

Use Render for backend/service monitoring:

- `Events` for deploy history
- `Logs` for runtime errors
- `Metrics` for request and resource trends
- `/health` for quick service state checks

### Cloudflare

Use Cloudflare Web Analytics for visitor and page-performance metrics.

## Troubleshooting

### If the live site shows no earthquake data

Check:

- `https://iceland-quake-monitoring-leaflet-deploy.onrender.com/health`
- `https://iceland-quake-monitoring-leaflet-deploy.onrender.com/earthquakes`

If the database was reset, the first request may trigger data bootstrap.

### If local works but deployed does not

Check:

- latest GitHub commit was deployed on Render
- frontend bundle updated after deploy
- Render service logs
- browser cache

### If analytics does not appear

Check:

- `VITE_CLOUDFLARE_ANALYTICS_TOKEN` is set in Render
- latest commit was redeployed
- Cloudflare Web Analytics site was created for the Render hostname

## Related files

- `render.yaml`
- `RENDER_DEPLOY.md`
- `backend/app.py`
- `backend/requirements-render.txt`
- `frontend/src/main.jsx`
- `frontend/index.html`
