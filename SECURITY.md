# Security Considerations

Before handing this over for production deployment, review the following items. Items marked **DONE** have already been addressed in the codebase.

## 1. Flask Debug Mode - DONE

`backend/app.py` runs with debug disabled for direct local execution:

```python
app.run(debug=False, port=5001)
```

Production uses Gunicorn on a loopback-only address behind nginx:

```bash
gunicorn -b 127.0.0.1:6000 app:app --chdir backend
```

## 2. CORS - DONE

CORS is restricted to local frontend dev origins:

```python
_ALLOWED_ORIGINS = [
    "http://localhost:5174",
    "http://127.0.0.1:5174",
]
CORS(app, origins=_ALLOWED_ORIGINS)
```

Production serves the frontend and API from the same origin, so no production CORS origin is required.

## 3. Maintenance Route Authorization - DONE

| Endpoint | Method | What it does | Protection |
|---|---|---|---|
| `/reconcile` | POST | Reruns reconciliation | `X-Admin-Token` in production |
| `/scrape-volcanoes` | POST | Triggers live EPOS volcano scrape | `X-Admin-Token` in production |
| `/initialize-data` | POST | Initializes an empty deployment | `X-Admin-Token` in production |

The scheduler handles normal ingestion. A loopback-only fallback is available only in development when `ALLOW_DEV_LOCAL_ADMIN=true`; the legacy `GET /scrape-volcanoes` route returns `405 Method Not Allowed`.

## 4. Error Message Leakage - DONE

Client-facing errors are generic. Full exceptions are logged server-side with `logging.exception()`.

Affected endpoints include `/scrape-volcanoes`, `/volcanoes`, and `/shakemap_lookup`.

## 5. Content Security Policy and Browser Headers - DONE

`frontend/index.html` includes a CSP meta tag for static/dev rendering. The Flask backend also emits HTTP security headers, which are required for directives such as `frame-ancestors`:

- `Content-Security-Policy`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`

The policy allows:

- Scripts and styles from `'self'`, with inline allowances needed by the current React mapping stack
- Images from `'self'`, data/blob URLs, Esri, OpenFreeMap, CARTO, IMO tile domains, and EGDI/HIKE map services
- Connections to the local Flask API plus OpenFreeMap, IMO, Esri/CARTO, and EGDI/HIKE services used by map layers and overlays
- Fonts from `'self'` and OpenFreeMap
- Frames blocked through HTTP `frame-ancestors 'none'` and `X-Frame-Options: DENY`

When deploying, update `connect-src` for the production API origin and remove development origins if they are not needed.

## 6. Unused API Keys - DONE

The application does not use Google Maps or require a Google Maps API key. The old unused key was removed.

## 7. Third-Party Tile and Data Services - REVIEW BEFORE PRODUCTION

The app currently uses OpenFreeMap, Esri, CARTO, IMO, EPOS, the Quakes API, MPGV, and EGDI/HIKE services. Confirm licensing and rate limits before public or institutional deployment. For formal deployment, prefer institution-managed tile infrastructure or provider accounts where required.

EGDI/HIKE fault and fissure linework is treated as reference data: the frontend fetches it on first use and keeps an in-memory cache for later overlay toggles. Earthquake and volcano data remain the live-refreshing datasets.

## 8. Frontend Dependency Audit - DONE

The local frontend dependency tree is expected to pass:

```bash
cd frontend
npm audit --audit-level=low
```

`frontend/package.json` includes an `overrides.esbuild` entry to keep Vite's esbuild dependency on a fixed version while staying compatible with the local Node 20 runtime. `frontend/vite.config.js` sets both production build and dev dependency optimization targets to `esnext`.

## 9. Rate Limiting - DONE

The Flask backend uses Flask-Limiter with conservative per-client API limits. Defaults are environment-configurable:

| Variable | Default |
|---|---|
| `RATE_LIMIT_DEFAULT` | `300 per minute` |
| `RATE_LIMIT_EARTHQUAKES` | `120 per minute` |
| `RATE_LIMIT_VOLCANOES` | `120 per minute` |
| `RATE_LIMIT_SHAKEMAP` | `60 per minute` |
| `RATE_LIMIT_CSV` | `10 per minute` |
| `RATE_LIMIT_ADMIN` | `5 per minute` |
| `RATE_LIMIT_STORAGE` | `memory://` |

`/health` is exempt for monitoring. Authenticated maintenance routes use `RATE_LIMIT_ADMIN`; initialization is additionally limited to three requests per hour.

`memory://` is acceptable for local development and simple single-process deployments. For production with multiple workers or servers, use shared storage such as Redis:

```bash
RATE_LIMIT_STORAGE=redis://redis-host:6379/0
```

See `RATE_LIMITING.md` for the full policy. Prefer reverse-proxy or platform-level rate limits in addition to app-level limits for formal public deployment.

## Maintenance Route Authorization

State-changing maintenance routes require `X-Admin-Token` in production:

- `POST /reconcile`
- `POST /scrape-volcanoes`
- `POST /initialize-data`

`ADMIN_TOKEN` is required for production maintenance. If it is missing, public read routes continue to work and maintenance routes return a controlled disabled response. Tokens are not accepted through query strings or `Authorization`.

Local loopback fallback is available only when `APP_ENV` is a development value and `ALLOW_DEV_LOCAL_ADMIN=true`; do not enable that on Pluto.

Initial data loading for an empty deployment is now an explicit maintenance operation, not a public GET side effect. After setting the private production token, run:

```bash
curl -X POST -H "X-Admin-Token: $ADMIN_TOKEN" http://127.0.0.1:6000/initialize-data
```

## Trusted Proxy Checklist

Set `TRUSTED_PROXY_COUNT=1` only after confirming exactly one trusted nginx proxy is in front of Gunicorn. Direct local development should use `TRUSTED_PROXY_COUNT=0`. When trusted headers are enabled, Gunicorn must listen only on loopback or a Unix socket and port `6000` must not be directly public.

Ask the server administrator to confirm nginx sets `X-Forwarded-For`, sets `X-Forwarded-Proto`, forwards the expected Host, validates Host headers, and blocks direct public access to Gunicorn.

## 10. Database File Permissions - TODO DEPLOYMENT

Tighten SQLite permissions on the server:

```bash
chmod 700 backend/data/
chmod 600 backend/data/earthquakes.db
```

## 11. HTTPS - SERVER ADMINISTRATION REQUIRED

Pluto nginx currently listens only on port 80 and has no active TLS certificate or port 443 listener. Public HTTPS must be configured by the Pluto server administrator at nginx, followed by an HTTP-to-HTTPS redirect. Flask, React, Gunicorn, and `deploy.sh` do not control public TLS; Gunicorn should continue serving plain HTTP on `127.0.0.1:6000` behind nginx.

## 12. Frontend API URL Detection - DONE

`frontend/src/api.js` points to `http://localhost:5001` only for `localhost` and `127.0.0.1`. In production it uses same-origin requests based on `BASE_URL`.

## 13. Map Attribution - DONE

The map uses a compact bottom-right attribution control. It lists the active basemap providers and appends EGDI/HIKE, ISOR when the faults overlay is visible. Full provider and licensing review is still required before formal public or institutional deployment.

## 14. Secret Key - TODO IF AUTH IS ADDED

The app currently does not use Flask sessions or CSRF. If authentication is added later, configure a real secret key:

```python
app.config["SECRET_KEY"] = os.environ["FLASK_SECRET_KEY"]
```
