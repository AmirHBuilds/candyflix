import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";

import DetailActions from "@/components/DetailActions";
import * as watchlist from "@/lib/watchlist";
import * as playback from "@/lib/playback";

vi.mock("@/lib/watchlist", async () => {
  const actual = await vi.importActual<typeof watchlist>("@/lib/watchlist");
  return { ...actual, getWatchlistStatus: vi.fn().mockResolvedValue(false) };
});

vi.mock("@/lib/playback", async () => {
  const actual = await vi.importActual<typeof playback>("@/lib/playback");
  return { ...actual, getLatestTVWatchProgress: vi.fn() };
});

describe("DetailActions — movie", () => {
  it("Watch Now is a link, enabled immediately (watchHref always provided)", () => {
    render(<DetailActions watchHref="/watch/movie/603" tmdbId={603} mediaType="movie" />);
    const link = screen.getByRole("link", { name: "Watch Now" });
    expect(link).toHaveAttribute("href", "/watch/movie/603");
  });
});

describe("DetailActions — TV, with watch history", () => {
  it("resumes at the last-watched episode and shows its label, once resolved", async () => {
    vi.mocked(playback.getLatestTVWatchProgress).mockResolvedValue({
      tmdb_id: 1396,
      media_type: "tv",
      season_number: 2,
      episode_number: 8,
      position_seconds: 300,
      duration_seconds: 2700,
    });

    render(<DetailActions tmdbId={1396} mediaType="tv" />);

    // Disabled only for the brief moment before history resolves —
    // not permanently, which is the bug this fixes.
    await waitFor(() => expect(screen.getByRole("link", { name: "Watch Now" })).toBeInTheDocument());
    const link = screen.getByRole("link", { name: "Watch Now" });
    expect(link).toHaveAttribute("href", "/watch/tv/1396/2/8");
    expect(screen.getByText("S2:E8")).toBeInTheDocument();
  });
});

describe("DetailActions — TV, never started", () => {
  it("starts from episode 1 and shows no resume label", async () => {
    vi.mocked(playback.getLatestTVWatchProgress).mockResolvedValue(null);

    render(<DetailActions tmdbId={1396} mediaType="tv" />);

    await waitFor(() => expect(screen.getByRole("link", { name: "Watch Now" })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Watch Now" })).toHaveAttribute(
      "href",
      "/watch/tv/1396/1/1"
    );
    expect(screen.queryByText(/^S\d+:E\d+$/)).not.toBeInTheDocument();
  });
});

describe("DetailActions — TV, history lookup fails", () => {
  it("fails toward starting from episode 1 rather than staying disabled forever", async () => {
    vi.mocked(playback.getLatestTVWatchProgress).mockRejectedValue(new Error("network error"));

    render(<DetailActions tmdbId={1396} mediaType="tv" />);

    await waitFor(() => expect(screen.getByRole("link", { name: "Watch Now" })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Watch Now" })).toHaveAttribute(
      "href",
      "/watch/tv/1396/1/1"
    );
  });
});
