import { describe, it, expect, vi, beforeEach } from "vitest";

import { saveWatchProgress, saveWatchProgressBeacon, flushWatchProgressAndNavigate } from "@/lib/playback";

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

describe("flushWatchProgressAndNavigate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => null }) as unknown as typeof fetch;
    document.body.innerHTML = "";
  });

  it("awaits the save (using the live <video> element's position) before navigating", async () => {
    // Regression test for a real bug: keepalive alone only guarantees a
    // save isn't cancelled by navigation — it does NOT guarantee the
    // save lands before the NEXT page's own server-side read of "what's
    // the latest episode?", since the two requests race with no
    // ordering guarantee. Clicking through episodes quickly showed a
    // stale resume point until an unrelated later reload happened to
    // land after the delayed save. Awaiting the save here before ever
    // starting navigation removes that race entirely.
    const video = document.createElement("video");
    Object.defineProperty(video, "duration", { value: 1000, configurable: true });
    Object.defineProperty(video, "currentTime", { value: 42, configurable: true });
    document.body.appendChild(video);

    const location = { href: "" };
    Object.defineProperty(window, "location", { value: location, writable: true, configurable: true });

    const order: string[] = [];
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      order.push("save");
      return { ok: true, json: async () => null };
    });

    await flushWatchProgressAndNavigate(
      { tmdbId: 1396, mediaType: "tv", seasonNumber: 1, episodeNumber: 3 },
      "/watch/tv/1396/1/4"
    );
    order.push("navigate-observed");

    expect(order).toEqual(["save", "navigate-observed"]);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/watch-progress"),
      expect.objectContaining({
        body: JSON.stringify({
          tmdb_id: 1396,
          media_type: "tv",
          season_number: 1,
          episode_number: 3,
          position_seconds: 42,
          duration_seconds: 1000,
        }),
      })
    );
    expect(location.href).toBe("/watch/tv/1396/1/4");
  });

  it("navigates even if there's no <video> element (e.g. the detail page) or the save fails", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network error"));

    const location = { href: "" };
    Object.defineProperty(window, "location", { value: location, writable: true, configurable: true });

    await flushWatchProgressAndNavigate({ tmdbId: 1396, mediaType: "tv" }, "/tv/1396");

    expect(location.href).toBe("/tv/1396");
  });
});
