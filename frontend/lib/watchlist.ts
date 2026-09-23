import { getApiBaseUrl } from "@/lib/api-client";
import type { MediaItem, MediaType } from "@/lib/media";

async function handle<T>(res: Response, fallbackMessage: string): Promise<T> {
  if (!res.ok) {
    let message = fallbackMessage;
    try {
      const body = await res.json();
      if (body?.detail) message = body.detail;
    } catch {
      // Body wasn't JSON — stick with the fallback.
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// WatchlistItemOut on the backend deliberately mirrors MediaItem's shape
// (tmdb_id, media_type, title, year, poster_path, backdrop_path,
// rating) — that's what lets the Candy Box page render with MediaGrid
// directly, no new card component needed.
export type WatchlistItem = MediaItem & { added_at: string };

export async function getWatchlist(): Promise<WatchlistItem[]> {
  const res = await fetch(`${getApiBaseUrl()}/watchlist`, {
    credentials: "include",
    cache: "no-store",
  });
  return handle(res, "Couldn't load your Candy Box.");
}

export async function addToWatchlist(mediaType: MediaType, tmdbId: number): Promise<void> {
  const res = await fetch(`${getApiBaseUrl()}/watchlist`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ media_type: mediaType, tmdb_id: tmdbId }),
  });
  return handle(res, "Couldn't add that to your Candy Box.");
}

export async function removeFromWatchlist(mediaType: MediaType, tmdbId: number): Promise<void> {
  const res = await fetch(`${getApiBaseUrl()}/watchlist/${mediaType}/${tmdbId}`, {
    method: "DELETE",
    credentials: "include",
  });
  return handle(res, "Couldn't remove that from your Candy Box.");
}

export async function getWatchlistStatus(mediaType: MediaType, tmdbId: number): Promise<boolean> {
  const query = new URLSearchParams({ media_type: mediaType, tmdb_id: String(tmdbId) });
  const res = await fetch(`${getApiBaseUrl()}/watchlist/status?${query.toString()}`, {
    credentials: "include",
    cache: "no-store",
  });
  const data = await handle<{ in_watchlist: boolean }>(res, "Couldn't check your Candy Box.");
  return data.in_watchlist;
}
