# Security Considerations

Before handing this over to IMO for production deployment, the following things need to be addressed. Items marked **DONE** have already been fixed in the codebase.

---

## 1. Flask Debug Mode — DONE

`backend/app.py`, line 477:

```python
app.run(debug=False, port=5001)
```

Debug mode is now off. For production, use gunicorn instead of `app.run()` altogether:

```bash
gunicorn -b 0.0.0.0:5001 app:app --chdir backend
```

Gunicorn ignores the debug flag entirely, so this is the cleaner production setup.

---

## 2. CORS — DONE

`backend/app.py`, lines 33–37:

```python
_ALLOWED_ORIGINS = [
    "http://localhost:5174",
    "http://127.0.0.1:5174",
]
CORS(app, origins=_ALLOWED_ORIGINS)
```

CORS is now restricted to the known frontend dev origins. **When deploying**, add the production domain to `_ALLOWED_ORIGINS` (or drop CORS entirely if frontend and backend are behind the same reverse proxy).

---

## 3. Unprotected Admin Endpoints — DONE

Both admin endpoints now reject requests from non-localhost addresses with 403 Forbidden:

| Endpoint | What it does | Protection |
|---|---|---|
| `POST /reconcile` | Reruns the full reconciliation algorithm | `request.remote_addr` must be `127.0.0.1` or `::1` |
| `GET /scrape-volcanoes` | Triggers a live EPOS API scrape | Same localhost check |

The scheduler handles all ingestion automatically, so these are only needed for manual debugging from the server itself.

---

## 4. Error Message Leakage — DONE

Error responses no longer expose internal exception details to clients. Instead:
- Full exceptions are logged server-side via `logging.exception()`
- Clients receive generic messages like `"Internal server error"` or `"upstream fetch error"`

Affected endpoints: `/scrape-volcanoes`, `/shakemap_lookup`.

---

## 5. Content Security Policy — DONE

`frontend/index.html` now includes a CSP meta tag restricting:
- Scripts and styles to `'self'` (plus `'unsafe-inline'` for Leaflet/React compatibility)
- Images to `'self'`, `data:` URIs, Esri's ArcGIS CDN (`server.arcgisonline.com`, `services.arcgisonline.com`, `basemaps.arcgis.com`), IMO raster tiles (`geo.vedur.is`), and OpenFreeMap/OpenMapTiles assets for the roadmap
- API connections to `localhost:5001` / `127.0.0.1:5001`
- Frames blocked entirely (`frame-ancestors 'none'`)

**When deploying**, update `connect-src` to include the production API domain.

---

## 6. Unused API Key Removed — DONE

`frontend/.env` contained an unused Google Maps API key left over from the pre-Leaflet migration. The file has been deleted. The Leaflet version uses only free tile providers and requires no API keys.

---

## 7. Rate Limiting — TODO

No rate limiting on any endpoint. Worth adding at the nginx level if this goes on a public IP:

```nginx
limit_req_zone $binary_remote_addr zone=api:10m rate=60r/m;
```

Or use Flask-Limiter if nginx isn't in the picture.

---

## 8. Database File Permissions — TODO (deployment)

`backend/data/earthquakes.db` — make sure permissions are tight on the server:

```bash
chmod 700 backend/data/
chmod 600 backend/data/earthquakes.db
```

Only matters if there are other users on the same machine, but worth doing anyway.

---

## 9. HTTPS — TODO (deployment)

The app doesn't enforce HTTPS (expected for local dev, not for production). TLS should be terminated at the reverse proxy; Flask doesn't need to handle it directly. Standard nginx setup with Let's Encrypt or an IMO cert is sufficient.

---

## 10. Frontend API URL Detection

`frontend/src/api.js`, lines 4–6:

```javascript
const isLocalDev = window.location.hostname === "localhost"
    || window.location.hostname === "127.0.0.1";
export const API_URL = isLocalDev ? "http://localhost:5001" : "";
```

No action needed — this correctly falls back to same-origin requests in production. Just noting it here so it doesn't look like a magic empty string to whoever reads the code next.

---

## 11. Secret Key — TODO (if auth is added)

Flask needs a `SECRET_KEY` for sessions and CSRF. The app doesn't use either right now, so it's not an issue, but if auth gets added later:

```python
app.config["SECRET_KEY"] = os.environ.get("FLASK_SECRET_KEY", "change-me-in-production")
```
