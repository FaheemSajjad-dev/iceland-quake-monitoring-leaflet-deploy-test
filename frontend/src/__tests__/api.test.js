import { afterEach, expect, it, vi } from "vitest";
import { fetchShakeMapValidated } from "../api";

afterEach(() => vi.unstubAllGlobals());

it("bypasses browser caches for on-demand ShakeMap lookups", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      found: true,
      url: "https://data.epos-iceland.is/files/seismic/shakemaps/example.jpg",
      dt_sec: 0,
      match_method: "mpgv_origin_time",
    }),
  });
  vi.stubGlobal("fetch", fetchMock);

  const result = await fetchShakeMapValidated("2026-03-31 07:11:02.000");

  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining("/shakemap_lookup?"),
    { cache: "no-store" },
  );
  const url = new URL(fetchMock.mock.calls[0][0], "https://example.test");
  expect([...url.searchParams.keys()]).toEqual(["dt"]);
  expect(url.searchParams.get("dt")).toBe("2026-03-31 07:11:02.000");
  expect(result).toMatchObject({ available: true, dt_sec: 0, match_method: "mpgv_origin_time" });
});
