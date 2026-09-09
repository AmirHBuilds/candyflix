import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

const genres = [
  { id: 28, name: "Action" },
  { id: 35, name: "Comedy" },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MediaBrowser — Load More", () => {
  it("shows the Load More button when hasMore is true, and not when false", () => {
    const { unmount } = render(
      <MediaBrowser
        mediaType="movie"
        genres={genres}
        initialItems={makeItems(20)}
        initialHasMore={true}
        emptyLabel="Nothing"
        errorLabel="Error"
      />
    );
    expect(screen.getByRole("button", { name: /load more/i })).toBeInTheDocument();
    unmount();

    render(
      <MediaBrowser
        mediaType="movie"
        genres={genres}
        initialItems={makeItems(20)}
        initialHasMore={false}
        emptyLabel="Nothing"
        errorLabel="Error"
      />
    );
    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
  });

  it("appends the next page's items and requests page 2, not page 1 again", async () => {
    const user = userEvent.setup();
    vi.mocked(media.getPopularMoviesPage).mockResolvedValue({
      items: makeItems(5, 21),
      hasMore: false,
    });

    render(
      <MediaBrowser
        mediaType="movie"
        genres={genres}
        initialItems={makeItems(20)}
        initialHasMore={true}
        emptyLabel="Nothing"
        errorLabel="Error"
      />
    );

    await user.click(screen.getByRole("button", { name: /load more/i }));

    await waitFor(() => {
      expect(media.getPopularMoviesPage).toHaveBeenCalledWith(2);
    });
    expect(screen.getAllByText(/^Title \d+$/)).toHaveLength(25);
    // Load More disappears once the new response says hasMore: false.
    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
  });

  it("shows the error label if loading more fails, without wiping existing items", async () => {
    const user = userEvent.setup();
    vi.mocked(media.getPopularMoviesPage).mockRejectedValue(new Error("network"));

    render(
      <MediaBrowser
        mediaType="movie"
        genres={genres}
        initialItems={makeItems(3)}
        initialHasMore={true}
        emptyLabel="Nothing"
        errorLabel="Something broke."
      />
    );

    await user.click(screen.getByRole("button", { name: /load more/i }));

    expect(await screen.findByText("Something broke.")).toBeInTheDocument();
    expect(screen.getAllByText(/^Title \d+$/)).toHaveLength(3);
  });
});

describe("MediaBrowser — advanced search integration", () => {
  it("applying a filter calls discoverMovies (not the plain popular endpoint) and resets to page 1", async () => {
    const user = userEvent.setup();
    vi.mocked(media.discoverMovies).mockResolvedValue({
      items: makeItems(4, 100),
      hasMore: true,
    });

    render(
      <MediaBrowser
        mediaType="movie"
        genres={genres}
        initialItems={makeItems(20)}
        initialHasMore={true}
        emptyLabel="Nothing"
        errorLabel="Error"
      />
    );

    await user.click(screen.getByRole("button", { name: /advanced search/i }));
    await user.selectOptions(screen.getByLabelText(/genre/i), "28");
    await user.click(screen.getByRole("button", { name: /^search$/i }));

    await waitFor(() => {
      expect(media.discoverMovies).toHaveBeenCalledWith(1, expect.objectContaining({ genre: 28 }));
    });
    // Filtered result set replaces the old one, doesn't append to it.
    expect(screen.getAllByText(/^Title \d+$/)).toHaveLength(4);
    expect(media.getPopularMoviesPage).not.toHaveBeenCalled();
  });

  it("Load More after a filter is applied continues using discoverMovies at the next page", async () => {
    const user = userEvent.setup();
    vi.mocked(media.discoverMovies).mockResolvedValueOnce({
      items: makeItems(20, 1),
      hasMore: true,
    });

    render(
      <MediaBrowser
        mediaType="movie"
        genres={genres}
        initialItems={makeItems(20)}
        initialHasMore={true}
        emptyLabel="Nothing"
        errorLabel="Error"
      />
    );

    await user.click(screen.getByRole("button", { name: /advanced search/i }));
    await user.selectOptions(screen.getByLabelText(/genre/i), "28");
    await user.click(screen.getByRole("button", { name: /^search$/i }));
    await waitFor(() => expect(media.discoverMovies).toHaveBeenCalledTimes(1));

    vi.mocked(media.discoverMovies).mockResolvedValueOnce({
      items: makeItems(6, 200),
      hasMore: false,
    });
    await user.click(screen.getByRole("button", { name: /load more/i }));

    await waitFor(() => {
      expect(media.discoverMovies).toHaveBeenLastCalledWith(2, expect.objectContaining({ genre: 28 }));
    });
  });

  it("clearing filters goes back to the plain popular endpoint at page 1", async () => {
    const user = userEvent.setup();
    vi.mocked(media.discoverMovies).mockResolvedValue({ items: makeItems(4, 100), hasMore: false });
    vi.mocked(media.getPopularMoviesPage).mockResolvedValue({ items: makeItems(20), hasMore: true });

    render(
      <MediaBrowser
        mediaType="movie"
        genres={genres}
        initialItems={makeItems(20)}
        initialHasMore={true}
        emptyLabel="Nothing"
        errorLabel="Error"
      />
    );

    await user.click(screen.getByRole("button", { name: /advanced search/i }));
    await user.selectOptions(screen.getByLabelText(/genre/i), "28");
    await user.click(screen.getByRole("button", { name: /^search$/i }));
    await waitFor(() => expect(media.discoverMovies).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: /^clear$/i }));

    await waitFor(() => {
      expect(media.getPopularMoviesPage).toHaveBeenCalledWith(1);
    });
  });
});
