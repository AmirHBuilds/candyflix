import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";

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

function progressRow(episode_number: number, position_seconds: number, updated_at: string, duration_seconds = 1000) {
  return {
    tmdb_id: 1396,
    media_type: "tv" as const,
    season_number: 1,
    episode_number,
    position_seconds,
    duration_seconds,
    updated_at,
  };
}

function resumeEpisode(episode_number: number) {
  return progressRow(episode_number, 500, "2026-01-01T00:00:00Z");
}

function episodeRow(name: RegExp) {
  return screen.getByText(name).closest("a")!;
}

describe("SeasonBrowser — resume point (detail-page 'pink name')", () => {
  it("gives the resume-point episode's name the pink/highlighted treatment, with no 'Now playing' text", async () => {
    vi.mocked(playback.getSeasonWatchProgress).mockResolvedValue([]);

    render(<SeasonBrowser tvId={1396} seasons={seasons} resumeEpisode={resumeEpisode(3)} />);

    await screen.findByText(/Pilot/);
    const ep3 = episodeRow(/\.\.\.And the Bag's in the River/);
    expect(ep3.querySelector("p")).toHaveClass("text-[#FF5FA2]");
    expect(ep3.textContent).not.toMatch(/Now playing/);

    const ep1 = episodeRow(/Pilot/);
    expect(ep1.querySelector("p")).not.toHaveClass("text-[#FF5FA2]");
  });

  it("does not mark the resume-point episode as 'In progress' too — only the pink name", async () => {
    // A progress row for the resume episode itself is present (as it
    // always would be), but it must never compete for the separate
    // "In progress" slot — this is exactly the reported bug (both
    // episode 1 and episode 3 showing "In progress" at once).
    vi.mocked(playback.getSeasonWatchProgress).mockResolvedValue([progressRow(3, 500, "2026-01-01T00:00:00Z")]);

    render(<SeasonBrowser tvId={1396} seasons={seasons} resumeEpisode={resumeEpisode(3)} />);

    await screen.findByText(/Pilot/);
    expect(screen.queryByText("In progress")).not.toBeInTheDocument();
  });
});

describe("SeasonBrowser — the one secondary 'In progress' episode", () => {
  it("flags only the most recently touched, unfinished, non-resume episode", async () => {
    vi.mocked(playback.getSeasonWatchProgress).mockResolvedValue([
      progressRow(1, 200, "2026-01-01T00:00:00Z"), // older, unfinished
      progressRow(2, 300, "2026-01-02T00:00:00Z"), // most recent, unfinished — this one
    ]);

    render(<SeasonBrowser tvId={1396} seasons={seasons} resumeEpisode={resumeEpisode(3)} />);

    await screen.findByText("In progress");
    expect(screen.getAllByText("In progress")).toHaveLength(1);
    const ep2 = episodeRow(/Cat's in the Bag/);
    expect(ep2.textContent).toContain("In progress");
    const ep1 = episodeRow(/Pilot/);
    expect(ep1.textContent).not.toContain("In progress");
  });

  it("excludes a finished episode from ever taking the secondary slot", async () => {
    vi.mocked(playback.getSeasonWatchProgress).mockResolvedValue([
      progressRow(1, 999, "2026-01-02T00:00:00Z", 1000), // 99.9% — finished, most recent
      progressRow(2, 300, "2026-01-01T00:00:00Z"), // unfinished, older — should win instead
    ]);

    render(<SeasonBrowser tvId={1396} seasons={seasons} resumeEpisode={resumeEpisode(3)} />);

    await screen.findByText("In progress");
    const ep2 = episodeRow(/Cat's in the Bag/);
    expect(ep2.textContent).toContain("In progress");
  });

  it("shows no 'In progress' label at all when nothing else has been touched", async () => {
    vi.mocked(playback.getSeasonWatchProgress).mockResolvedValue([]);

    render(<SeasonBrowser tvId={1396} seasons={seasons} resumeEpisode={resumeEpisode(3)} />);

    await screen.findByText(/Pilot/);
    expect(screen.queryByText("In progress")).not.toBeInTheDocument();
  });

  it("fails toward no highlighting rather than an error, if the progress lookup fails", async () => {
    vi.mocked(playback.getSeasonWatchProgress).mockRejectedValue(new Error("network error"));

    render(<SeasonBrowser tvId={1396} seasons={seasons} resumeEpisode={resumeEpisode(3)} />);

    await screen.findByText(/Pilot/);
    expect(screen.queryByText("In progress")).not.toBeInTheDocument();
  });
});

describe("SeasonBrowser — watch-page 'Now playing' still works", () => {
  it("marks the currently-playing episode, and does not also let it consume the secondary slot", async () => {
    vi.mocked(playback.getSeasonWatchProgress).mockResolvedValue([progressRow(2, 500, "2026-01-05T00:00:00Z")]);

    render(<SeasonBrowser tvId={1396} seasons={seasons} initialSeason={1} currentEpisode={2} />);

    await screen.findByText("Now playing");
    // Episode 2 is "Now playing", not additionally "In progress" — and
    // no other episode had progress, so the slot is simply unused.
    expect(screen.queryByText("In progress")).not.toBeInTheDocument();
  });
});
