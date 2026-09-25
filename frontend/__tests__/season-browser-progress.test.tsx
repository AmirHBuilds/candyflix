import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";

import SeasonBrowser from "@/components/SeasonBrowser";
import * as media from "@/lib/media";
import * as playback from "@/lib/playback";

vi.mock("@/lib/media", async () => {
  const actual = await vi.importActual<typeof media>("@/lib/media");
  return {
    ...actual,
    getSeason: vi.fn().mockResolvedValue({
      tv_id: 1396,
      season_number: 1,
      name: "Season 1",
      episodes: [
        { episode_number: 1, name: "Pilot", overview: "", still_path: null, air_date: null, runtime_minutes: null },
        { episode_number: 2, name: "Cat's in the Bag...", overview: "", still_path: null, air_date: null, runtime_minutes: null },
        { episode_number: 3, name: "...And the Bag's in the River", overview: "", still_path: null, air_date: null, runtime_minutes: null },
      ],
    }),
  };
});

vi.mock("@/lib/playback", async () => {
  const actual = await vi.importActual<typeof playback>("@/lib/playback");
  return { ...actual, getSeasonWatchProgress: vi.fn() };
});

const seasons = [{ season_number: 1, name: "Season 1", episode_count: 3, poster_path: null }];

function progressRow(episode_number: number, position_seconds: number, duration_seconds = 1000) {
  return {
    tmdb_id: 1396,
    media_type: "tv" as const,
    season_number: 1,
    episode_number,
    position_seconds,
    duration_seconds,
  };
}

describe("SeasonBrowser — watched-episode highlighting", () => {
  it("marks a partially-watched episode as 'In progress' and a finished one as 'Watched', leaving the rest unmarked", async () => {
    vi.mocked(playback.getSeasonWatchProgress).mockResolvedValue([
      progressRow(1, 500), // 50% through
      progressRow(2, 1000), // fully watched
      // episode 3: no progress at all
    ]);

    render(<SeasonBrowser tvId={1396} seasons={seasons} />);

    await waitFor(() => expect(screen.getByText("In progress")).toBeInTheDocument());
    expect(screen.getByText("Watched")).toBeInTheDocument();

    // Episode 3 has neither label.
    const ep3 = screen.getByText(/3\. \.\.\.And the Bag's in the River/);
    expect(ep3.textContent).not.toMatch(/Watched|In progress/);
  });

  it("shows no highlighting at all when nothing has been watched", async () => {
    vi.mocked(playback.getSeasonWatchProgress).mockResolvedValue([]);

    render(<SeasonBrowser tvId={1396} seasons={seasons} />);

    await screen.findByText(/Pilot/);
    expect(screen.queryByText("Watched")).not.toBeInTheDocument();
    expect(screen.queryByText("In progress")).not.toBeInTheDocument();
  });

  it("fails toward no highlighting rather than an error, if the progress lookup fails", async () => {
    vi.mocked(playback.getSeasonWatchProgress).mockRejectedValue(new Error("network error"));

    render(<SeasonBrowser tvId={1396} seasons={seasons} />);

    await screen.findByText(/Pilot/);
    expect(screen.queryByText("Watched")).not.toBeInTheDocument();
    expect(screen.queryByText("In progress")).not.toBeInTheDocument();
  });

  it("suppresses the watched label on the episode already marked 'Now playing'", async () => {
    vi.mocked(playback.getSeasonWatchProgress).mockResolvedValue([progressRow(2, 500)]);

    render(<SeasonBrowser tvId={1396} seasons={seasons} initialSeason={1} currentEpisode={2} />);

    await screen.findByText("Now playing");
    expect(screen.queryByText("In progress")).not.toBeInTheDocument();
    expect(screen.queryByText("Watched")).not.toBeInTheDocument();
  });
});
