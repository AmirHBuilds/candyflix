import { getApiBaseUrl } from "@/lib/api-client";

export type MediaType = "movie" | "tv";

export type MediaItem = {
  tmdb_id: number;
  media_type: MediaType;
  title: string;
  year: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  rating: number | null;
};

export type MovieDetail = {
  tmdb_id: number;
  title: string;
  overview: string;
  year: string | null;
  genres: string[];
  poster_path: string | null;
  backdrop_path: string | null;
  rating: number | null;
  runtime_minutes: number | null;
};

export type SeasonSummary = {
  season_number: number;
  name: string;
  episode_count: number;
  poster_path: string | null;
};

export type TVShowDetail = {
  tmdb_id: number;
  title: string;
  overview: string;
  year: string | null;
  genres: string[];
  poster_path: string | null;
  backdrop_path: string | null;
  rating: number | null;
  seasons: SeasonSummary[];
};

export type Episode = {
  episode_number: number;
  name: string;
  overview: string;
  still_path: string | null;
  air_date: string | null;
  runtime_minutes: number | null;
};

export type SeasonDetail = {
  tv_id: number;
  season_number: number;
  name: string;
  episodes: Episode[];
};

async function handle<T>(res: Response, notFoundMessage: string): Promise<T> {
  if (res.status === 404) throw new Error(notFoundMessage);
  if (!res.ok) throw new Error("Something went wrong loading that.");
  return res.json();
}

// Shared everywhere a MediaItem links to its own detail page (cards,
// hero, search suggestions) — one place to know the /movie vs /tv split.
export function detailHref(item: Pick<MediaItem, "media_type" | "tmdb_id">): string {
  return item.media_type === "movie" ? `/movie/${item.tmdb_id}` : `/tv/${item.tmdb_id}`;
}

export async function getTrending(window: "day" | "week" = "day"): Promise<MediaItem[]> {
  const res = await fetch(`${getApiBaseUrl()}/trending?window=${window}`, { cache: "no-store" });
  return handle(res, "Trending is unavailable right now.");
}

export async function getPopularMovies(): Promise<MediaItem[]> {
  const res = await fetch(`${getApiBaseUrl()}/movies/popular`, { cache: "no-store" });
  return handle(res, "Popular movies are unavailable right now.");
}

export async function getPopularTV(): Promise<MediaItem[]> {
  const res = await fetch(`${getApiBaseUrl()}/tv/popular`, { cache: "no-store" });
  return handle(res, "Popular TV shows are unavailable right now.");
}

export async function getSimilarMovies(tmdbId: number | string): Promise<MediaItem[]> {
  const res = await fetch(`${getApiBaseUrl()}/movies/${tmdbId}/similar`, { cache: "no-store" });
  return handle(res, "Recommendations are unavailable right now.");
}

export async function getSimilarTV(tmdbId: number | string): Promise<MediaItem[]> {
  const res = await fetch(`${getApiBaseUrl()}/tv/${tmdbId}/similar`, { cache: "no-store" });
  return handle(res, "Recommendations are unavailable right now.");
}

export type Genre = {
  id: number;
  name: string;
};

export type PagedResult = {
  items: MediaItem[];
  hasMore: boolean;
};

export type SortOption = "popularity" | "rating" | "newest";

export type DiscoverFilters = {
  genre?: number;
  year?: number;
  sort?: SortOption;
  minRating?: number;
};

function toPagedResult(data: { items: MediaItem[]; has_more: boolean }): PagedResult {
  return { items: data.items, hasMore: data.has_more };
}

function discoverQuery(page: number, filters: DiscoverFilters): string {
  const params = new URLSearchParams({ page: String(page) });
  if (filters.genre !== undefined) params.set("genre", String(filters.genre));
  if (filters.year !== undefined) params.set("year", String(filters.year));
  if (filters.sort !== undefined) params.set("sort", filters.sort);
  if (filters.minRating !== undefined) params.set("min_rating", String(filters.minRating));
  return params.toString();
}

export async function getMovieGenres(): Promise<Genre[]> {
  const res = await fetch(`${getApiBaseUrl()}/movies/genres`, { cache: "no-store" });
  return handle(res, "Genres are unavailable right now.");
}

export async function getTVGenres(): Promise<Genre[]> {
  const res = await fetch(`${getApiBaseUrl()}/tv/genres`, { cache: "no-store" });
  return handle(res, "Genres are unavailable right now.");
}

export async function getPopularMoviesPage(page: number): Promise<PagedResult> {
  const res = await fetch(`${getApiBaseUrl()}/movies/popular/page?page=${page}`, {
    cache: "no-store",
  });
  return toPagedResult(await handle(res, "Popular movies are unavailable right now."));
}

export async function getPopularTVPage(page: number): Promise<PagedResult> {
  const res = await fetch(`${getApiBaseUrl()}/tv/popular/page?page=${page}`, {
    cache: "no-store",
  });
  return toPagedResult(await handle(res, "Popular TV shows are unavailable right now."));
}

export async function discoverMovies(page: number, filters: DiscoverFilters): Promise<PagedResult> {
  const res = await fetch(`${getApiBaseUrl()}/movies/discover?${discoverQuery(page, filters)}`, {
    cache: "no-store",
  });
  return toPagedResult(await handle(res, "Search is unavailable right now."));
}

export async function discoverTV(page: number, filters: DiscoverFilters): Promise<PagedResult> {
  const res = await fetch(`${getApiBaseUrl()}/tv/discover?${discoverQuery(page, filters)}`, {
    cache: "no-store",
  });
  return toPagedResult(await handle(res, "Search is unavailable right now."));
}

export async function searchMedia(query: string, signal?: AbortSignal): Promise<MediaItem[]> {
  const res = await fetch(
    `${getApiBaseUrl()}/search?q=${encodeURIComponent(query)}`,
    { cache: "no-store", signal }
  );
  return handle(res, "Search is unavailable right now.");
}

export async function getMovie(tmdbId: number | string): Promise<MovieDetail> {
  const res = await fetch(`${getApiBaseUrl()}/movies/${tmdbId}`, { cache: "no-store" });
  return handle(res, "This movie couldn't be found.");
}

export async function getTVShow(tmdbId: number | string): Promise<TVShowDetail> {
  const res = await fetch(`${getApiBaseUrl()}/tv/${tmdbId}`, { cache: "no-store" });
  return handle(res, "This show couldn't be found.");
}

export async function getSeason(
  tmdbId: number | string,
  seasonNumber: number
): Promise<SeasonDetail> {
  const res = await fetch(`${getApiBaseUrl()}/tv/${tmdbId}/season/${seasonNumber}`, {
    cache: "no-store",
  });
  return handle(res, "This season couldn't be found.");
}

// TMDB image helpers — every component uses these rather than building
// image.tmdb.org URLs itself, so the CDN choice lives in one place.
const IMG_BASE = "https://image.tmdb.org/t/p";

export function posterUrl(path: string | null, size: "w342" | "w500" = "w342") {
  return path ? `${IMG_BASE}/${size}${path}` : null;
}

export function backdropUrl(
  path: string | null,
  size: "w780" | "w1280" | "original" = "w1280"
) {
  return path ? `${IMG_BASE}/${size}${path}` : null;
}

export function stillUrl(path: string | null, size: "w300" = "w300") {
  return path ? `${IMG_BASE}/${size}${path}` : null;
}

/**
 * TMDB's `overview` field is often a full multi-sentence synopsis,
 * which reads as a wall of text next to a Watch Now button. This
 * keeps the first sentence(s) up to a length budget, preferring to
 * end on real sentence-ending punctuation rather than mid-word.
 *
 * This truncates the real TMDB text rather than generating new copy
 * (no summarization model involved) — a deliberate, honest tradeoff:
 * it won't read as polished as a hand-written logline, but it's
 * deterministic, free, and never invents plot details.
 */
export function shortenOverview(text: string, maxLength = 200): string {
  if (!text || text.length <= maxLength) return text;

  const window = text.slice(0, maxLength);

  // Prefer cutting at the end of a full sentence within the budget.
  const sentenceEnd = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("! "),
    window.lastIndexOf("? ")
  );
  if (sentenceEnd > maxLength * 0.4) {
    return window.slice(0, sentenceEnd + 1);
  }

  // Otherwise cut at the last full word and mark it as truncated.
  const lastSpace = window.lastIndexOf(" ");
  return `${window.slice(0, lastSpace > 0 ? lastSpace : maxLength)}…`;
}
