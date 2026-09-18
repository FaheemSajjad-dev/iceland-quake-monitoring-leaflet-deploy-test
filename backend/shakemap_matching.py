"""Associate EPOS products with the retained MPGV origin time, never proximity."""
from datetime import datetime, timezone
import re

EPOS_SHAKEMAP_API = "https://api.vedur.is/epos/seismic/shakemaps"
MATCH_METHOD = "mpgv_origin_time"
POLICY_NOTE = "Exact MPGV origin-time association v1"


def origin_time(value):
    """Parse complete ISO timestamps, retaining fractional seconds and UTC offsets."""
    if not isinstance(value, str) or not re.fullmatch(
        r"\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})?",
        value,
    ):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)
    except ValueError:
        return None


def select_shakemap(items, event_time, validate_url):
    """Return (product, reason); ambiguous products are never resolved by distance.

    Repeated records pointing to the same viewer are one deliverable. Multiple
    distinct viewers at the exact time require a source/version policy we do not
    have, so fail closed. Missing/unsafe URLs do not establish a usable product.
    """
    target = origin_time(event_time)
    if target is None:
        return None, "invalid_event_time"
    products = {}
    for item in items:
        if not isinstance(item, dict) or origin_time(item.get("origin_time")) != target:
            continue
        raw_url = item.get("url_view_file")
        if not isinstance(raw_url, str):
            continue
        try:
            url = validate_url(raw_url.strip())
        except (TypeError, ValueError):
            url = None
        if url:
            products.setdefault(url, {**item, "url_view_file": url})
    if not products:
        return None, "no_exact_match"
    if len(products) != 1:
        return None, "ambiguous"
    return next(iter(products.values())), None
