import { describe, it, expect, vi, beforeEach } from "vitest";
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

beforeEach(() => {
  vi.clearAllMocks();
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
  it("marks the currently-playing episode, and never shows 'In progress' on the player page", async () => {
    render(<SeasonBrowser tvId={1396} seasons={seasons} initialSeason={1} currentEpisode={2} />);

    await screen.findByText("Now playing");
    // The whole secondary "In progress" system is switched off in the
    // player context — getSeasonWatchProgress shouldn't even be called.
    expect(playback.getSeasonWatchProgress).not.toHaveBeenCalled();
    expect(screen.queryByText("In progress")).not.toBeInTheDocument();
  });

  it("gives the resume point a distinct mint color (not pink) and its own 'Last watched' label when it differs from what's playing", async () => {
    // Regression test for the reported bug: watching episode 1 while
    // the show's actual resume point is episode 3 — episode 3 must
    // still be visibly marked, but distinguishably from "Now playing"
    // (previously both were identically pink, which was the complaint),
    // and never demoted to the generic "In progress" label.
    render(
      <SeasonBrowser
        tvId={1396}
        seasons={seasons}
        initialSeason={1}
        currentEpisode={1}
        resumeEpisode={resumeEpisode(3)}
      />
    );

    await screen.findByText("Now playing");
    const ep1 = episodeRow(/Pilot/);
    expect(ep1.textContent).toContain("Now playing");
    expect(ep1.querySelector("p")).toHaveClass("text-[#FF5FA2]");

    const ep3 = episodeRow(/\.\.\.And the Bag's in the River/);
    expect(ep3.textContent).toContain("Last watched");
    expect(ep3.textContent).not.toMatch(/Now playing|In progress/);
    // Distinct from "Now playing"'s pink — this is the fix for "both of
    // them have pink title".
    expect(ep3.querySelector("p")).toHaveClass("text-[#8FE3C7]");
    expect(ep3.querySelector("p")).not.toHaveClass("text-[#FF5FA2]");

    expect(screen.queryByText("In progress")).not.toBeInTheDocument();
  });

  it("shows only pink 'Now playing', with no separate label, when the resume point IS what's currently playing", async () => {
    render(
      <SeasonBrowser
        tvId={1396}
        seasons={seasons}
        initialSeason={1}
        currentEpisode={3}
        resumeEpisode={resumeEpisode(3)}
      />
    );

    const ep3 = await screen.findByText(/\.\.\.And the Bag's in the River/);
    const row = ep3.closest("a")!;
    expect(row.textContent).toContain("Now playing");
    expect(row.textContent).not.toContain("Last watched");
    expect(row.querySelector("p")).toHaveClass("text-[#FF5FA2]");
  });
});
