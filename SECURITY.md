# Security Considerations

Before handing this over for production deployment, review the following items. Items marked **DONE** have already been addressed in the codebase.

## 1. Flask Debug Mode - DONE

`backend/app.py` runs with debug disabled for direct local execution:

```python
app.run(debug=False, port=5001)
```

For production, run behind a WSGI server instead:

```bash
gunicorn -b 0.0.0.0:5001 app:app --chdir backend
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

When deploying, add the production domain or serve frontend and backend behind the same reverse proxy and remove cross-origin access.

## 3. Localhost-Only Admin Endpoints - DONE

| Endpoint | Method | What it does | Protection |
|---|---|---|---|
| `/reconcile` | POST | Reruns reconciliation | `request.remote_addr` must be `127.0.0.1` or `::1` |
| `/scrape-volcanoes` | GET | Triggers live EPOS volcano scrape | Same localhost check |

The scheduler handles normal ingestion automatically, so these are only for local/server-side maintenance.

## 4. Error Message Leakage - DONE

Client-facing errors are generic. Full exceptions are logged server-side with `logging.exception()`.

Affected endpoints include `/scrape-volcanoes`, `/volcanoes`, and `/shakemap_lookup`.

## 5. Content Security Policy - DONE

`frontend/index.html` includes a CSP meta tag. It currently allows:

- Scripts and styles from `'self'`, with inline allowances needed by the current Leaflet/React stack
- Images from `'self'`, data/blob URLs, Esri, OpenFreeMap, CARTO, IMO tile domains, and EGDI/HIKE map services
- Connections to the local Flask API plus OpenFreeMap, IMO, Esri/CARTO, and EGDI/HIKE services used by map layers and overlays
- Fonts from `'self'` and OpenFreeMap
- Frames blocked with `frame-ancestors 'none'`

When deploying, update `connect-src` for the production API origin and remove development origins if they are not needed.

## 6. Unused API Keys - DONE

The Leaflet version does not use Google Maps and does not require a Google Maps API key. The old `.env` file containing an unused key has been removed.

## 7. Third-Party Tile and Data Services - REVIEW BEFORE PRODUCTION

The app currently uses OpenFreeMap, Esri, CARTO, IMO, EPOS, Skjalftalisa, MPGV, and EGDI/HIKE services. Confirm licensing and rate limits before public or institutional deployment. For formal deployment, prefer institution-managed tile infrastructure or provider accounts where required.

## 8. Rate Limiting - TODO

There is no application-level rate limiting. Add rate limiting at nginx or another reverse proxy if the app is exposed publicly:

```nginx
limit_req_zone $binary_remote_addr zone=api:10m rate=60r/m;
```

Flask-Limiter is another option if reverse-proxy limiting is unavailable.

## 9. Database File Permissions - TODO DEPLOYMENT

Tighten SQLite permissions on the server:

```bash
chmod 700 backend/data/
chmod 600 backend/data/earthquakes.db
```

## 10. HTTPS - TODO DEPLOYMENT

Terminate TLS at the reverse proxy using Let's Encrypt or an institutional certificate. Flask does not need to serve TLS directly.

## 11. Frontend API URL Detection - DONE

`frontend/src/api.js` points to `http://localhost:5001` only for `localhost` and `127.0.0.1`. In production it uses same-origin requests based on `BASE_URL`.

## 12. Secret Key - TODO IF AUTH IS ADDED

The app currently does not use Flask sessions or CSRF. If authentication is added later, configure a real secret key:

```python
app.config["SECRET_KEY"] = os.environ["FLASK_SECRET_KEY"]
```
