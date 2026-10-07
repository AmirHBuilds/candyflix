import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DetailRatings from "@/components/DetailRatings";
import { SettingsProvider } from "@/components/SettingsProvider";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import type { Settings } from "@/lib/settings";

vi.mock("@/lib/rating-sources", async (orig) => {
  const real = await orig<typeof import("@/lib/rating-sources")>();
  return { ...real, getRatings: vi.fn() };
});
import { getRatings } from "@/lib/rating-sources";
const realGetRatings = async (...a: Parameters<typeof getRatings>) => (await vi.importActual<typeof import("@/lib/rating-sources")>("@/lib/rating-sources")).getRatings(...a);

const EXTERNAL = [
  { source: "imdb" as const, label: "IMDb", display: "8.7", suffix: "/10", value: 8.7, votes: 2100345, url: "https://www.imdb.com/title/tt1/" },
  { source: "rotten_tomatoes" as const, label: "Rotten Tomatoes", display: "83%", suffix: "", value: 83, votes: null, url: null },
  { source: "metacritic" as const, label: "Metacritic", display: "73", suffix: "/100", value: 73, votes: null, url: null },
];

function withSources(over: Partial<Settings["appearance"]["rating_sources"]> = {}) {
  return {
    ...DEFAULT_SETTINGS,
    appearance: { ...DEFAULT_SETTINGS.appearance, rating_sources: { ...DEFAULT_SETTINGS.appearance.rating_sources, ...over } },
  };
}
const show = (initial = DEFAULT_SETTINGS, tmdbRating: number | null = 7.8) =>
  render(
    <SettingsProvider initial={initial}>
      <DetailRatings mediaType="movie" tmdbId={603} tmdbRating={tmdbRating} />
    </SettingsProvider>
  );
const shown = () => screen.queryAllByRole("listitem").map((li) => li.getAttribute("data-rating"));

beforeEach(() => vi.mocked(getRatings).mockReset().mockResolvedValue({ ratings: EXTERNAL, configured: true }));
afterEach(cleanup);

describe("DetailRatings", () => {
  it("shows TMDB at once and the other sites when the server has them, in a fixed order", async () => {
    show();
    expect(shown()).toEqual(["tmdb"]);
    await waitFor(() => expect(shown()).toEqual(["tmdb", "imdb", "rotten_tomatoes", "metacritic"]));
    expect(screen.getByLabelText("IMDb 8.7/10")).toBeTruthy();
    expect(screen.getByLabelText("Rotten Tomatoes 83%")).toBeTruthy();
    expect(screen.getByText(/IMDb · 2.1M/)).toBeTruthy();
  });

  it("links the sites that have a page for the title", async () => {
    show();
    const imdb = await screen.findByLabelText("IMDb 8.7/10");
    expect(imdb.getAttribute("href")).toBe("https://www.imdb.com/title/tt1/");
    expect(imdb.getAttribute("target")).toBe("_blank");
    expect(screen.getByLabelText("TMDB 7.8/10").getAttribute("href")).toBe("https://www.themoviedb.org/movie/603");
    expect(screen.getByLabelText("Metacritic 73/100").getAttribute("href")).toBeNull();
  });

  it("leaves out the sources the person switched off", async () => {
    show(withSources({ rotten_tomatoes: false, tmdb: false }));
    await waitFor(() => expect(shown()).toEqual(["imdb", "metacritic"]));
  });

  it("does not ask the server at all when only TMDB is on", () => {
    show(withSources({ imdb: false, rotten_tomatoes: false, metacritic: false }));
    expect(getRatings).not.toHaveBeenCalled();
    expect(shown()).toEqual(["tmdb"]);
  });

  it("shows nothing (not an empty box) when there is nothing to show", async () => {
    vi.mocked(getRatings).mockResolvedValue({ ratings: [], configured: false });
    const { container } = show(DEFAULT_SETTINGS, null);
    await waitFor(() => expect(getRatings).toHaveBeenCalled());
    expect(container.querySelector("ul")).toBeNull();
  });

  it("keeps TMDB when the server has no other scores", async () => {
    vi.mocked(getRatings).mockResolvedValue({ ratings: [], configured: true });
    show();
    await waitFor(() => expect(getRatings).toHaveBeenCalled());
    expect(shown()).toEqual(["tmdb"]);
  });
});

describe("getRatings", () => {
  it("turns a server error into no extra scores instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    expect(await realGetRatings("movie", 1)).toEqual({ ratings: [], configured: true });
    vi.unstubAllGlobals();
  });
});
