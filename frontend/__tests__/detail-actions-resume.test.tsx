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
  it("Watch Now is an enabled link straight to the player (also on the home hero, which passes no href)", () => {
    render(<DetailActions tmdbId={603} mediaType="movie" />);
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

describe("DetailActions — home hero (TV with no tvProgress prop)", () => {
  it("looks up the latest progress itself and resumes there", async () => {
    vi.mocked(playback.getLatestTVWatchProgress).mockResolvedValue(progress(3, 4));
    render(<DetailActions tmdbId={1396} mediaType="tv" />);

    const link = await screen.findByRole("link", { name: /S3:E4/ });
    expect(link).toHaveAttribute("href", "/watch/tv/1396/3/4");
    expect(playback.getLatestTVWatchProgress).toHaveBeenCalledWith(1396);
  });

  it("is enabled from the first render (S1:E1) and stays there when the show was never started", async () => {
    vi.mocked(playback.getLatestTVWatchProgress).mockResolvedValue(null);
    render(<DetailActions tmdbId={1396} mediaType="tv" />);

    expect(screen.getByRole("link", { name: /Watch Now/ })).toHaveAttribute("href", "/watch/tv/1396/1/1");
    await waitFor(() => expect(playback.getLatestTVWatchProgress).toHaveBeenCalled());
    expect(screen.getByRole("link", { name: "Watch Now" })).toHaveAttribute("href", "/watch/tv/1396/1/1");
  });

  it("falls back to S1:E1 if the lookup fails", async () => {
    vi.mocked(playback.getLatestTVWatchProgress).mockRejectedValue(new Error("boom"));
    render(<DetailActions tmdbId={1396} mediaType="tv" />);
    await waitFor(() => expect(playback.getLatestTVWatchProgress).toHaveBeenCalled());
    expect(screen.getByRole("link", { name: /Watch Now/ })).toHaveAttribute("href", "/watch/tv/1396/1/1");
  });

  it("does not look anything up when the page already supplied tvProgress (or a movie)", () => {
    vi.mocked(playback.getLatestTVWatchProgress).mockClear();
    render(<DetailActions tmdbId={1396} mediaType="tv" tvProgress={null} />);
    render(<DetailActions tmdbId={603} mediaType="movie" />);
    expect(playback.getLatestTVWatchProgress).not.toHaveBeenCalled();
  });
});

describe("DetailActions — button sizing (class structure only; real widths need a browser)", () => {
  it("gives Watch Now and Add to Candy Box the same fixed height and one shared column width", () => {
    render(<DetailActions tmdbId={1396} mediaType="tv" tvProgress={progress(1, 8)} />);
    const watch = screen.getByRole("link", { name: /Watch Now/ });
    const candy = screen.getByRole("button", { name: /Candy Box/ });
    expect(watch).toHaveClass("h-12");
    expect(candy).toHaveClass("h-12");
    // Equal widths come from the parent grid, not from matching paddings.
    expect(watch.parentElement!.className).toContain(":auto-cols-fr");
    expect(candy.parentElement).toBe(watch.parentElement);
  });

  it("renders the resume label as a rounded rectangle chip (not a pill) that stays high-contrast", () => {
    render(<DetailActions tmdbId={1396} mediaType="tv" tvProgress={progress(1, 8)} />);
    const chip = screen.getByText("S1:E8");
    expect(chip).toHaveClass("rounded-md");
    expect(chip).not.toHaveClass("rounded-full");
    expect(chip).toHaveClass("bg-canvas", "text-white");
  });

  it("uses the wider-threshold class set for a long label like S10:E12", () => {
    const { container: short } = render(<DetailActions tmdbId={1} mediaType="tv" tvProgress={progress(1, 8)} />);
    const { container: long } = render(<DetailActions tmdbId={2} mediaType="tv" tvProgress={progress(10, 12)} />);
    const grid = (c: HTMLElement) => c.querySelector(".grid")!.className;
    expect(grid(short)).toContain("@[452px]:text-base");
    expect(grid(long)).toContain("@[484px]:text-base");
  });
});
