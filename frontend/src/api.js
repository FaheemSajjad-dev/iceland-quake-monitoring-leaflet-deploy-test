import axios from "axios";

// In dev, point explicitly at the Flask backend (port 5001) on the same
// hostname used to load Vite. Mixing localhost and 127.0.0.1 creates distinct
// browser origins and can trip CORS during local development.
const isLocalDev = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const base = import.meta.env.BASE_URL.replace(/\/$/, '');
export const API_URL = isLocalDev ? `${window.location.protocol}//${window.location.hostname}:5001` : base;

export const DEPTH_POLICIES = Object.freeze({
    MATCHED_ONLY: "reference_only",
    INCLUDE_UNVERIFIED: "include_unverified",
});

export const normalizeLimitsResponse = (payload, expectedPolicy) => {
    const magnitude = payload?.magnitude_limits;
    const depth = payload?.depth_limits;
    if (
        payload?.depth_quality !== expectedPolicy ||
        !Number.isFinite(magnitude?.minimum) ||
        !Number.isFinite(magnitude?.maximum) ||
        magnitude.minimum > magnitude.maximum
    ) {
        throw new Error("Invalid magnitude limits response");
    }
    const noEligibleDepths = depth === null ||
        (depth?.minimum === null && depth?.maximum === null);
    const validDepths = Number.isFinite(depth?.minimum) &&
        Number.isFinite(depth?.maximum) &&
        depth.minimum <= depth.maximum;
    if (!noEligibleDepths && !validDepths) {
        throw new Error("Invalid depth limits response");
    }
    return {
        depth_quality: expectedPolicy,
        magnitude_limits: {
            minimum: magnitude.minimum,
            maximum: magnitude.maximum,
        },
        depth_limits: validDepths
            ? { minimum: depth.minimum, maximum: depth.maximum }
            : null,
    };
};

export const fetchEarthquakeData = async (signal) => {
    const response = await axios.get(`${API_URL}/earthquakes`, { signal });
    return Array.isArray(response.data) ? response.data : [];
};

export const fetchInsightsLimits = async (depthQuality, signal) => {
    const response = await axios.get(`${API_URL}/insights/limits`, {
        params: { depth_quality: depthQuality },
        signal,
    });
    try {
        return normalizeLimitsResponse(response.data, depthQuality);
    } catch (error) {
        const contentType = response.headers?.["content-type"] || "unknown content type";
        const contractError = new Error(
            `HTTP ${response.status} — ${error.message}; received ${contentType}`,
        );
        contractError.status = response.status;
        contractError.contentType = contentType;
        contractError.body = response.data;
        throw contractError;
    }
};

export const fetchVolcanoData = async (signal) => {
    try {
        const response = await axios.get(`${API_URL}/volcanoes`, { signal });
        return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
        if (signal?.aborted || axios.isCancel(error)) throw error;
        console.error("Error fetching volcano data:", error);
        return [];
    }
};

export async function fetchShakeMapValidated(dt, lat, lon) {
  try {
    const params = new URLSearchParams({ dt, lat, lon });
    const res = await fetch(`${API_URL}/shakemap_lookup?${params}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.found) return null;
    return {
      available: true,
      url: data.url,
      dt_sec: Math.round((data.minutes_diff || 0) * 60),
      dist_km: data.distance_km,
      dm: null,
    };
  } catch {
    return null;
  }
}
