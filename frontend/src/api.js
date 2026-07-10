import axios from "axios";

// In dev, point explicitly at the Flask backend (port 5001) on the same
// hostname used to load Vite. Mixing localhost and 127.0.0.1 creates distinct
// browser origins and can trip CORS during local development.
const isLocalDev = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const base = import.meta.env.BASE_URL.replace(/\/$/, '');
export const API_URL = isLocalDev ? `${window.location.protocol}//${window.location.hostname}:5001` : base;

export const fetchEarthquakeData = async () => {
    try {
        const response = await axios.get(`${API_URL}/earthquakes`);
        return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
        console.error("Error fetching earthquake data:", error);
        return [];
    }
};

export const fetchVolcanoData = async () => {
    try {
        const response = await axios.get(`${API_URL}/volcanoes`);
        return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
        console.error("Error fetching volcano data:", error);
        return [];
    }
};

export const triggerVolcanoScrape = async () => {
    try {
        const response = await axios.get(`${API_URL}/scrape-volcanoes`);
        return response.data;
    } catch (error) {
        console.error("Error triggering volcano scrape:", error);
        throw error;
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