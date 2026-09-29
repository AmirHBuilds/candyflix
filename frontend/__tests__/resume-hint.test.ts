import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  navigateWithResumeHint,
  mergeResumeWithHint,
  parseResumeHintFromSearchParams,
  type WatchProgress,
} from "@/lib/playback";

function progress(season: number, episode: number): WatchProgress {
  return {
    tmdb_id: 1396,
    media_type: "tv",
    season_number: season,
    episode_number: episode,
    position_seconds: 100,
    duration_seconds: 1000,
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function mockLocation() {
  const location = { href: "" };
  Object.defineProperty(window, "location", { value: location, writable: true, configurable: true });
  return location;
}

function addVideo(currentTime = 42, duration = 1000) {
  const video = document.createElement("video");
  Object.defineProperty(video, "duration", { value: duration, configurable: true });
  Object.defineProperty(video, "currentTime", { value: currentTime, configurable: true });
  document.body.appendChild(video);
}

describe("navigateWithResumeHint — never blocks on the network", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("navigates immediately even if the save never resolves (a slow or dead connection)", () => {
    // The whole point of this design: the earlier await-then-navigate
    // version froze episode switching for however long a slow network
    // took. This must return and navigate synchronously regardless of
    // how the background save behaves.
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {})) as unknown as typeof fetch; // never resolves
    addVideo();
    const location = mockLocation();

    navigateWithResumeHint(
      { tmdbId: 1396, mediaType: "tv", seasonNumber: 1, episodeNumber: 6 },
      "/watch/tv/1396/1/2"
    );

    // No await anywhere above — if this were still blocking, the
    // assertion below would run before location.href was ever set.
    expect(location.href).toBe("/watch/tv/1396/1/2?fromSeason=1&fromEpisode=6");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("still fires the background save with the live video position", () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => null }) as unknown as typeof fetch;
    addVideo(42, 1000);
    mockLocation();

    navigateWithResumeHint(
      { tmdbId: 1396, mediaType: "tv", seasonNumber: 1, episodeNumber: 6 },
      "/watch/tv/1396/1/2"
    );

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/watch-progress"),
      expect.objectContaining({
        keepalive: true,
        body: JSON.stringify({
          tmdb_id: 1396,
          media_type: "tv",
          season_number: 1,
          episode_number: 6,
          position_seconds: 42,
          duration_seconds: 1000,
        }),
      })
    );
  });

  it("swallows a failed background save rather than surfacing an unhandled rejection", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network error")) as unknown as typeof fetch;
    addVideo();
    const location = mockLocation();

    expect(() =>
      navigateWithResumeHint({ tmdbId: 1396, mediaType: "tv", seasonNumber: 1, episodeNumber: 6 }, "/tv/1396")
    ).not.toThrow();
    // Let the rejected promise settle — an unhandled rejection would fail the run.
    await Promise.resolve();
    await Promise.resolve();
    expect(location.href).toBe("/tv/1396?fromSeason=1&fromEpisode=6");
  });

  it("still hints (no minimum) even when there's no <video> element to save a position from", () => {
    // The hint reflects the episode identity passed in by the caller,
    // not whether a video happened to load — e.g. BackToDetailsLink
    // firing before any playback occurred should still count.
    global.fetch = vi.fn() as unknown as typeof fetch;
    const location = mockLocation();

    navigateWithResumeHint({ tmdbId: 1396, mediaType: "tv", seasonNumber: 2, episodeNumber: 3 }, "/tv/1396");

    expect(global.fetch).not.toHaveBeenCalled();
    expect(location.href).toBe("/tv/1396?fromSeason=2&fromEpisode=3");
  });

  it("still hints even when the episode was only opened for a moment — any click counts", () => {
    // Not gated on watch duration: clicking a new episode should make
    // it "last watched" immediately, even if closed a second later.
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => null }) as unknown as typeof fetch;
    addVideo(2, 1000);
    const location = mockLocation();

    navigateWithResumeHint(
      { tmdbId: 1396, mediaType: "tv", seasonNumber: 1, episodeNumber: 10 },
      "/watch/tv/1396/1/2"
    );

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(location.href).toBe("/watch/tv/1396/1/2?fromSeason=1&fromEpisode=10");
  });

  it("leaves a movie's href untouched — no season/episode ordering to hint at", () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => null }) as unknown as typeof fetch;
    addVideo();
    const location = mockLocation();

    navigateWithResumeHint({ tmdbId: 603, mediaType: "movie" }, "/movie/603");

    expect(location.href).toBe("/movie/603");
  });

  it("preserves any query params already on the destination href", () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => null }) as unknown as typeof fetch;
    addVideo(42, 1000);
    const location = mockLocation();

    navigateWithResumeHint(
      { tmdbId: 1396, mediaType: "tv", seasonNumber: 1, episodeNumber: 6 },
      "/watch/tv/1396/1/2?t=30"
    );

    expect(location.href).toBe("/watch/tv/1396/1/2?t=30&fromSeason=1&fromEpisode=6");
  });
});

describe("mergeResumeWithHint", () => {
  it("returns the server's value unchanged when there's no hint", () => {
    const server = progress(1, 5);
    expect(mergeResumeWithHint(server, null, 1396)).toBe(server);
    expect(mergeResumeWithHint(null, null, 1396)).toBeNull();
  });

  it("lets a hint that's further along than the server win — the exact reported bug", () => {
    // Server still says S1:E5 (the save for E6 hasn't landed yet), but
    // the person just came from E6.
    const merged = mergeResumeWithHint(progress(1, 5), { seasonNumber: 1, episodeNumber: 6 }, 1396);
    expect(merged?.season_number).toBe(1);
    expect(merged?.episode_number).toBe(6);
  });

  it("keeps the server's value when it's already at or past the hint (never moves backward)", () => {
    const server = progress(1, 8);
    expect(mergeResumeWithHint(server, { seasonNumber: 1, episodeNumber: 6 }, 1396)).toBe(server);
    // Equal counts as "server is at least as far" too.
    const equal = progress(1, 6);
    expect(mergeResumeWithHint(equal, { seasonNumber: 1, episodeNumber: 6 }, 1396)).toBe(equal);
  });

  it("compares season before episode", () => {
    const server = progress(1, 20);
    const merged = mergeResumeWithHint(server, { seasonNumber: 2, episodeNumber: 1 }, 1396);
    expect(merged?.season_number).toBe(2);
    expect(merged?.episode_number).toBe(1);

    const serverLater = progress(2, 1);
    expect(mergeResumeWithHint(serverLater, { seasonNumber: 1, episodeNumber: 20 }, 1396)).toBe(serverLater);
  });

  it("uses the hint alone when the server has nothing for this show yet", () => {
    const merged = mergeResumeWithHint(null, { seasonNumber: 1, episodeNumber: 1 }, 1396);
    expect(merged).toMatchObject({ tmdb_id: 1396, media_type: "tv", season_number: 1, episode_number: 1 });
  });
});

describe("parseResumeHintFromSearchParams", () => {
  it("parses a valid hint", () => {
    expect(parseResumeHintFromSearchParams({ fromSeason: "1", fromEpisode: "6" })).toEqual({
      seasonNumber: 1,
      episodeNumber: 6,
    });
  });

  it("takes the first value when a param is repeated", () => {
    expect(parseResumeHintFromSearchParams({ fromSeason: ["2", "9"], fromEpisode: ["3", "9"] })).toEqual({
      seasonNumber: 2,
      episodeNumber: 3,
    });
  });

  it("returns null when either half is missing", () => {
    expect(parseResumeHintFromSearchParams({})).toBeNull();
    expect(parseResumeHintFromSearchParams({ fromSeason: "1" })).toBeNull();
    expect(parseResumeHintFromSearchParams({ fromEpisode: "6" })).toBeNull();
  });

  it("returns null for non-numeric garbage rather than throwing", () => {
    expect(parseResumeHintFromSearchParams({ fromSeason: "abc", fromEpisode: "6" })).toBeNull();
    expect(parseResumeHintFromSearchParams({ fromSeason: "1", fromEpisode: "NaN" })).toBeNull();
  });
});
