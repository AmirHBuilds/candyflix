import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";

import DetailActions from "@/components/DetailActions";
import * as watchlist from "@/lib/watchlist";

vi.mock("@/lib/watchlist", async () => {
  const actual = await vi.importActual<typeof watchlist>("@/lib/watchlist");
  return { ...actual, getWatchlistStatus: vi.fn().mockResolvedValue(false) };
});

function progress(season_number: number, episode_number: number) {
  return {
    tmdb_id: 1396,
    media_type: "tv" as const,
    season_number,
    episode_number,
    position_seconds: 300,
    duration_seconds: 2700,
    updated_at: "2026-01-01T00:00:00Z",
  };
}

describe("DetailActions — movie", () => {
  it("Watch Now is a link, enabled immediately (watchHref always provided)", () => {
    render(<DetailActions watchHref="/watch/movie/603" tmdbId={603} mediaType="movie" />);
    const link = screen.getByRole("link", { name: /Watch Now/ });
    expect(link).toHaveAttribute("href", "/watch/movie/603");
  });
});

describe("DetailActions — TV, with watch history", () => {
  it("resumes at the last-watched episode and shows its label inside the button, with no loading flash", () => {
    // tvProgress arrives already resolved (fetched server-side by the
    // TV detail page) — no async state, so this should be correct on
    // the very first render, unlike the old client-fetch design.
    render(<DetailActions tmdbId={1396} mediaType="tv" tvProgress={progress(2, 8)} />);

    const link = screen.getByRole("link", { name: /Watch Now/ });
    expect(link).toHaveAttribute("href", "/watch/tv/1396/2/8");
    // The label lives inside the same button, not as a separate element.
    expect(link).toHaveTextContent("S2:E8");
  });
});

describe("DetailActions — TV, never started", () => {
  it("starts from episode 1 and shows no resume label", () => {
    render(<DetailActions tmdbId={1396} mediaType="tv" tvProgress={null} />);

    const link = screen.getByRole("link", { name: "Watch Now" });
    expect(link).toHaveAttribute("href", "/watch/tv/1396/1/1");
  });
});
