import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ toString: () => "" }) }));

import Home from "@/app/(main)/page";
import MovieDetailPage from "@/app/(main)/movie/[id]/page";
import TVDetailPage from "@/app/(main)/tv/[id]/page";
import * as media from "@/lib/media";
import * as cw from "@/lib/continue-watching-server";
import * as playbackServer from "@/lib/playback-server";

vi.mock("@/lib/media", async () => {
  const actual = await vi.importActual<typeof media>("@/lib/media");
  return {
    ...actual,
    getTrending: vi.fn(),
    getPopularMovies: vi.fn(),
    getPopularTV: vi.fn(),
    getMovie: vi.fn(),
    getTVShow: vi.fn(),
    getSimilarMovies: vi.fn(),
    getSimilarTV: vi.fn(),
  };
});
vi.mock("@/lib/continue-watching-server", () => ({ getContinueWatchingServer: vi.fn() }));
vi.mock("@/lib/playback-server", async () => {
  const actual = await vi.importActual<typeof playbackServer>("@/lib/playback-server");
  return { ...actual, getLatestTVWatchProgressServer: vi.fn() };
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Let every already-queued microtask run, so anything the page started
// without waiting has had its chance to be called.
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => vi.clearAllMocks());

describe("home page loads its data in parallel", () => {
  it("starts Continue Watching together with the four rows, not after them", async () => {
    const pending = [deferred<never[]>(), deferred<never[]>(), deferred<never[]>(), deferred<never[]>()];
    const cwPending = deferred<{ items: never[]; hasMore: boolean }>();
    vi.mocked(media.getTrending).mockReturnValueOnce(pending[0].promise).mockReturnValueOnce(pending[1].promise);
    vi.mocked(media.getPopularMovies).mockReturnValue(pending[2].promise);
    vi.mocked(media.getPopularTV).mockReturnValue(pending[3].promise);
    vi.mocked(cw.getContinueWatchingServer).mockReturnValue(cwPending.promise);

    const page = Home();
    await flush();

    // Nothing has resolved yet, and all five requests are already in flight.
    expect(media.getTrending).toHaveBeenCalledTimes(2);
    expect(media.getPopularMovies).toHaveBeenCalledTimes(1);
    expect(media.getPopularTV).toHaveBeenCalledTimes(1);
    expect(cw.getContinueWatchingServer).toHaveBeenCalledTimes(1);

    pending.forEach((p) => p.resolve([]));
    cwPending.resolve({ items: [], hasMore: false });
    await page;
  });

  it("a failing Continue Watching call doesn't break the page", async () => {
    vi.mocked(media.getTrending).mockResolvedValue([]);
    vi.mocked(media.getPopularMovies).mockResolvedValue([]);
    vi.mocked(media.getPopularTV).mockResolvedValue([]);
    vi.mocked(cw.getContinueWatchingServer).mockRejectedValue(new Error("down"));

    await expect(Home()).resolves.toBeTruthy();
  });
});

describe("detail pages don't wait in a line", () => {
  it("movie: the similar-titles lookup starts while the movie itself is still loading", async () => {
    const movie = deferred<never>();
    vi.mocked(media.getMovie).mockReturnValue(movie.promise);
    vi.mocked(media.getSimilarMovies).mockResolvedValue([]);

    const page = MovieDetailPage({ params: Promise.resolve({ id: "603" }) });
    await flush();

    expect(media.getSimilarMovies).toHaveBeenCalledWith("603");
    movie.reject(new Error("404"));
    await expect(page).rejects.toThrow("NEXT_NOT_FOUND"); // unknown id still 404s
  });

  it("tv: similar titles and latest progress both start while the show itself is still loading", async () => {
    const show = deferred<never>();
    vi.mocked(media.getTVShow).mockReturnValue(show.promise);
    vi.mocked(media.getSimilarTV).mockResolvedValue([]);
    vi.mocked(playbackServer.getLatestTVWatchProgressServer).mockResolvedValue(null);

    const page = TVDetailPage({ params: Promise.resolve({ id: "1396" }), searchParams: Promise.resolve({}) });
    await flush();

    expect(media.getSimilarTV).toHaveBeenCalledWith("1396");
    expect(playbackServer.getLatestTVWatchProgressServer).toHaveBeenCalledWith(1396);
    show.reject(new Error("404"));
    await expect(page).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("a failing side request can't become an unhandled rejection when the title does exist", async () => {
    vi.mocked(media.getMovie).mockResolvedValue({
      tmdb_id: 603,
      title: "The Matrix",
      year: "1999",
      overview: "",
      poster_path: null,
      backdrop_path: null,
      rating: 8,
      genres: [],
      runtime_minutes: 136,
    } as never);
    vi.mocked(media.getSimilarMovies).mockRejectedValue(new Error("similar down"));

    await expect(MovieDetailPage({ params: Promise.resolve({ id: "603" }) })).resolves.toBeTruthy();
  });
});
