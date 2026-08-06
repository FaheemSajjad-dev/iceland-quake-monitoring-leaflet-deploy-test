import { afterEach, expect, it, vi } from "vitest";
import { fetchShakeMapValidated } from "../api";

afterEach(() => vi.unstubAllGlobals());

it("bypasses browser caches for on-demand ShakeMap lookups", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      found: true,
      url: "https://data.epos-iceland.is/files/seismic/shakemaps/example.jpg",
      minutes_diff: 0,
      distance_km: 0,
    }),
  });
  vi.stubGlobal("fetch", fetchMock);

  await fetchShakeMapValidated("2026-03-31 07:11:02.000", 64.669, -17.387);

  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining("/shakemap_lookup?"),
    { cache: "no-store" },
  );
});
