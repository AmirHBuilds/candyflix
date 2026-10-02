import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import MediaBrowser from "@/components/MediaBrowser";
import * as media from "@/lib/media";
import type { MediaItem } from "@/lib/media";

vi.mock("@/lib/media", async () => {
  const actual = await vi.importActual<typeof media>("@/lib/media");
  return {
    ...actual,
    getPopularMoviesPage: vi.fn(),
    getPopularTVPage: vi.fn(),
    discoverMovies: vi.fn(),
    discoverTV: vi.fn(),
  };
});

function makeItems(count: number, start = 1): MediaItem[] {
  return Array.from({ length: count }, (_, i) => ({
    tmdb_id: start + i,
    media_type: "movie" as const,
    title: `Title ${start + i}`,
    year: "2026",
    poster_path: `/p${start + i}.jpg`,
    backdrop_path: null,
    rating: 7,
  }));
}

const genres = [{ id: 28, name: "Action" }];

// A promise the test resolves by hand, to freeze the "loading" moment.
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function renderBrowser(over: Partial<React.ComponentProps<typeof MediaBrowser>> = {}) {
  return render(
    <MediaBrowser
      mediaType="movie"
      genres={genres}
      initialItems={makeItems(3)}
      initialHasMore={true}
      emptyLabel="No movies match your filters."
      errorLabel="Couldn't load more movies right now."
      {...over}
    />
  );
}

beforeEach(() => vi.clearAllMocks());

// Opens the Advanced Search panel, picks the Action genre and runs it.
async function applyActionFilter(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /advanced search/i }));
  await user.selectOptions(screen.getByLabelText(/genre/i), "28");
  await user.click(screen.getByRole("button", { name: /^search$/i }));
}

describe("MediaBrowser — loading states", () => {
  it("Load More keeps the current items and appends placeholder cards while it loads", async () => {
    const user = userEvent.setup();
    const d = deferred<{ items: MediaItem[]; hasMore: boolean }>();
    vi.mocked(media.getPopularMoviesPage).mockReturnValue(d.promise);
    renderBrowser();

    await user.click(screen.getByRole("button", { name: /load more/i }));

    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    expect(screen.getAllByText(/^Title \d+$/)).toHaveLength(3); // existing items stay put

    d.resolve({ items: makeItems(2, 10), hasMore: false });
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(screen.getAllByText(/^Title \d+$/)).toHaveLength(5);
  });

  it("applying a filter swaps the stale results for placeholders until the new ones arrive", async () => {
    const user = userEvent.setup();
    const d = deferred<{ items: MediaItem[]; hasMore: boolean }>();
    vi.mocked(media.discoverMovies).mockReturnValue(d.promise);
    renderBrowser();

    await applyActionFilter(user);

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText(/^Title \d+$/)).not.toBeInTheDocument(); // stale list hidden

    d.resolve({ items: makeItems(2, 50), hasMore: false });
    expect(await screen.findByText("Title 50")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("MediaBrowser — empty state", () => {
  it("shows the friendly empty state with the page's own empty message", () => {
    renderBrowser({ initialItems: [], initialHasMore: false });
    expect(screen.getByRole("heading", { name: "Nothing to show" })).toBeInTheDocument();
    expect(screen.getByText("No movies match your filters.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("offers 'Clear filters' when filters caused the empty result, and it reloads unfiltered", async () => {
    const user = userEvent.setup();
    vi.mocked(media.discoverMovies).mockResolvedValue({ items: [], hasMore: false });
    vi.mocked(media.getPopularMoviesPage).mockResolvedValue({ items: makeItems(2, 70), hasMore: false });
    renderBrowser();

    await applyActionFilter(user);

    const empty = await screen.findByRole("heading", { name: "Nothing to show" });
    // The empty state's own button (the filter panel has a "Clear filters" too).
    await user.click(within(empty.parentElement!.parentElement!).getByRole("button", { name: "Clear filters" }));

    expect(await screen.findByText("Title 70")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Nothing to show" })).not.toBeInTheDocument();
  });
});

describe("MediaBrowser — error state with retry", () => {
  it("a failed Load More shows an alert with 'Try again', keeps existing items, and retrying loads the page", async () => {
    const user = userEvent.setup();
    vi.mocked(media.getPopularMoviesPage)
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ items: makeItems(2, 20), hasMore: false });
    renderBrowser();

    await user.click(screen.getByRole("button", { name: /load more/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load more movies right now.");
    expect(screen.getAllByText(/^Title \d+$/)).toHaveLength(3);

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Title 20")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(media.getPopularMoviesPage).toHaveBeenLastCalledWith(2);
  });
});
