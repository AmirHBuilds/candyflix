import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCookieStore = {
  toString: vi.fn(() => "session=abc123; other=xyz"),
};

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => mockCookieStore),
}));

import { getMoviePlaybackSourceServer, getEpisodePlaybackSourceServer } from "@/lib/playback-server";

describe("playback-server — cookie forwarding", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockCookieStore.toString.mockReturnValue("session=abc123; other=xyz");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ source_type: "mock", url: "/mock-videos/x.mp4", subtitles: [] }),
    }) as unknown as typeof fetch;
  });

  it("attaches the forwarded cookie header on the movie playback request", async () => {
    await getMoviePlaybackSourceServer(550);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/playback/movie/550"),
      expect.objectContaining({
        headers: { Cookie: "session=abc123; other=xyz" },
      })
    );
  });

  it("attaches the forwarded cookie header on the episode playback request", async () => {
    await getEpisodePlaybackSourceServer(1399, 1, 2);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/playback/tv/1399/1/2"),
      expect.objectContaining({
        headers: { Cookie: "session=abc123; other=xyz" },
      })
    );
  });

  it("throws with the backend's error detail when the request is unauthenticated", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ detail: "Not authenticated" }),
    }) as unknown as typeof fetch;

    await expect(getMoviePlaybackSourceServer(550)).rejects.toThrow("Not authenticated");
  });

  it("forwards an empty cookie string as-is rather than skipping the header (no session to forward)", async () => {
    mockCookieStore.toString.mockReturnValue("");

    await getMoviePlaybackSourceServer(550);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: { Cookie: "" } })
    );
  });
});
