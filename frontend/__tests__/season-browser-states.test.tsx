import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import SeasonBrowser from "@/components/SeasonBrowser";
import * as media from "@/lib/media";
import * as playback from "@/lib/playback";

vi.mock("@/lib/media", async () => {
  const actual = await vi.importActual<typeof media>("@/lib/media");
  return { ...actual, getSeason: vi.fn() };
});
vi.mock("@/lib/playback", async () => {
  const actual = await vi.importActual<typeof playback>("@/lib/playback");
  return { ...actual, getSeasonWatchProgress: vi.fn().mockResolvedValue([]) };
});

const seasons = [{ season_number: 1, name: "Season 1", episode_count: 1, poster_path: null }];
const season = {
  tv_id: 1396,
  season_number: 1,
  name: "Season 1",
  episodes: [{ episode_number: 1, name: "Pilot", overview: "", still_path: null, air_date: null, runtime_minutes: null }],
};

beforeEach(() => vi.clearAllMocks());

describe("SeasonBrowser — loading & error states", () => {
  it("shows an episode-list skeleton while the season loads", async () => {
    let resolve!: (v: typeof season) => void;
    vi.mocked(media.getSeason).mockReturnValue(new Promise((r) => (resolve = r)));
    render(<SeasonBrowser tvId={1396} seasons={seasons} />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    resolve(season);
    expect(await screen.findByText(/Pilot/)).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("a failed season fetch shows an alert, and 'Try again' re-fetches the same season", async () => {
    vi.mocked(media.getSeason).mockRejectedValueOnce(new Error("nope")).mockResolvedValueOnce(season);
    render(<SeasonBrowser tvId={1396} seasons={seasons} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load episodes for this season.");

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText(/Pilot/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(media.getSeason).toHaveBeenCalledTimes(2);
    expect(media.getSeason).toHaveBeenLastCalledWith(1396, 1);
  });
});

describe("SeasonBrowser — long lists", () => {
  const many = {
    ...season,
    episodes: Array.from({ length: 14 }, (_, i) => ({ episode_number: i + 1, name: `Ep ${i + 1}`, overview: "", still_path: null, air_date: null, runtime_minutes: null })),
  };
  beforeEach(() => window.localStorage.clear());

  it("shows ten, 'Show all' reveals the rest and remembers it for that show only", async () => {
    vi.mocked(media.getSeason).mockResolvedValue(many);
    const { unmount } = render(<SeasonBrowser tvId={1396} seasons={[{ ...seasons[0], episode_count: 14 }]} />);
    expect(await screen.findByText(/Ep 10/)).toBeInTheDocument();
    expect(screen.queryByText(/Ep 11/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show all 14 episodes" }));
    expect(screen.getByText(/Ep 14/)).toBeInTheDocument();
    unmount();

    render(<SeasonBrowser tvId={1396} seasons={[{ ...seasons[0], episode_count: 14 }]} />);
    expect(await screen.findByText(/Ep 14/)).toBeInTheDocument(); // remembered
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
  });

  it("another show is still collapsed", async () => {
    window.localStorage.setItem("candyflix:episodes-expanded:1396", String(Date.now()));
    vi.mocked(media.getSeason).mockResolvedValue(many);
    render(<SeasonBrowser tvId={555} seasons={[{ ...seasons[0], episode_count: 14 }]} />);
    expect(await screen.findByText(/Ep 10/)).toBeInTheDocument();
    expect(screen.queryByText(/Ep 11/)).toBeNull();
  });

  it("never hides the episode that is playing", async () => {
    vi.mocked(media.getSeason).mockResolvedValue(many);
    render(<SeasonBrowser tvId={1396} seasons={[{ ...seasons[0], episode_count: 14 }]} initialSeason={1} currentEpisode={13} />);
    expect(await screen.findByText(/Ep 13/)).toBeInTheDocument();
  });
});
