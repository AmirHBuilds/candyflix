import { getApiBaseUrl } from "@/lib/api-client";

export type MediaType = "movie" | "tv";

export type MediaItem = {
  tmdb_id: number;
  media_type: MediaType;
  title: string;
  year: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
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

export async function getTrending(): Promise<MediaItem[]> {
  const res = await fetch(`${getApiBaseUrl()}/trending`, { cache: "no-store" });
  return handle(res, "Trending is unavailable right now.");
}

export async function searchMedia(query: string): Promise<MediaItem[]> {
  const res = await fetch(
    `${getApiBaseUrl()}/search?q=${encodeURIComponent(query)}`,
    { cache: "no-store" }
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

export function backdropUrl(path: string | null, size: "w780" | "w1280" = "w1280") {
  return path ? `${IMG_BASE}/${size}${path}` : null;
}

export function stillUrl(path: string | null, size: "w300" = "w300") {
  return path ? `${IMG_BASE}/${size}${path}` : null;
}
