import { describe, it, expect, vi, beforeEach } from "vitest";

import { saveWatchProgress, saveWatchProgressBeacon } from "@/lib/playback";

describe("saveWatchProgress — survives quick navigation away", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => null }) as unknown as typeof fetch;
  });

  it("uses keepalive so an in-flight save isn't killed by an immediate navigation", async () => {
    // Regression test for a real bug: without keepalive, clicking an
    // episode link navigates away immediately, and a plain fetch from
    // the page being left can be silently cancelled mid-flight. That
    // left the "high-water mark" stuck on a stale episode when someone
    // clicked through several episodes quickly — only the separate,
    // later pagehide/beacon save eventually corrected it, well after
    // the next page had already rendered with stale data.
    await saveWatchProgress({
      tmdb_id: 1396,
      media_type: "tv",
      season_number: 1,
      episode_number: 8,
      position_seconds: 12,
      duration_seconds: 1000,
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/watch-progress"),
      expect.objectContaining({ keepalive: true })
    );
  });
});

describe("saveWatchProgressBeacon", () => {
  it("still exists as the pagehide/backgrounding path (unaffected by the keepalive fix above)", () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "sendBeacon", { value: sendBeacon, configurable: true });

    saveWatchProgressBeacon({
      tmdb_id: 550,
      media_type: "movie",
      season_number: null,
      episode_number: null,
      position_seconds: 5,
      duration_seconds: 100,
    });

    expect(sendBeacon).toHaveBeenCalled();
  });
});
