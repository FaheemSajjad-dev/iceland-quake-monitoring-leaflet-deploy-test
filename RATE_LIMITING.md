# Rate Limiting Policy

This project applies conservative API rate limiting in the Flask backend. The limits are intended to reduce accidental refresh loops, scripted scraping, and expensive endpoint abuse while staying comfortably above normal public map usage.

Rate limiting is request-frequency control, not total user capacity control. Overall capacity still depends on caching, worker count, reverse proxy configuration, network bandwidth, and infrastructure monitoring.

## Defaults

| Endpoint | Default |
|---|---:|
| Application default | 300 requests per minute per client |
| `/earthquakes` | 120 requests per minute per client |
| `/volcanoes` | 120 requests per minute per client |
| `/shakemap_lookup` | 60 requests per minute per client |
| `/shakemap/<dt>` | 60 requests per minute per client |
| `/earthquakes_csv` | 10 requests per minute per client |
| `/health` | Exempt |
| `/reconcile` | Exempt from rate limiting; localhost-only |
| `/scrape-volcanoes` | Exempt from rate limiting; localhost-only |

When a client exceeds a limit, Flask-Limiter returns HTTP `429 Too Many Requests`.

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `RATE_LIMIT_ENABLED` | `true` | Set to `false` to disable app-level rate limiting |
| `RATE_LIMIT_DEFAULT` | `300 per minute` | Default limit for routes without a specific limit |
| `RATE_LIMIT_EARTHQUAKES` | `120 per minute` | `/earthquakes` |
| `RATE_LIMIT_VOLCANOES` | `120 per minute` | `/volcanoes` |
| `RATE_LIMIT_SHAKEMAP` | `60 per minute` | ShakeMap endpoints |
| `RATE_LIMIT_CSV` | `10 per minute` | `/earthquakes_csv` |
| `RATE_LIMIT_STORAGE` | `memory://` | Flask-Limiter storage backend |

`memory://` is acceptable for local development and single-process testing. Production deployments with multiple workers or servers should use shared storage, for example Redis:

```bash
RATE_LIMIT_STORAGE=redis://redis-host:6379/0
```

## Production Notes

- Keep `/health` exempt so uptime checks do not get blocked.
- Keep `/reconcile` and `/scrape-volcanoes` localhost-only or move them behind authenticated/internal access.
- Prefer reverse-proxy or platform-level limits in front of Flask for public deployments.
- If the app is deployed behind a proxy, configure trusted proxy handling so per-client limits use the real client IP rather than the proxy address.
