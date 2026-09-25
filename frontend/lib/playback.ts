import { getApiBaseUrl } from "@/lib/api-client";

export type SubtitleTrack = {
  language: string;
  label: string;
  url: string;
  format: "srt" | "vtt";
};

export type PlaybackSource = {
  source_type: "mock";
  url: string;
  subtitles: SubtitleTrack[];
  resume_position_seconds: number | null;
};

// Phase 5b — online subtitle discovery. OnlineSubtitleResult is what
// /subtitles/search returns (metadata + a file_id, not the subtitle
// text itself); downloading one returns a SubtitleTrack — identical in
// shape to a mock-provider track, so the player treats it the same way
// once it exists.
export type OnlineSubtitleResult = {
  file_id: number;
  language: string;
  label: string;
  release: string | null;
  downloads: number;
  rating: number | null;
  hearing_impaired: boolean;
};

export type OnlineSubtitleSearchParams = {
  mediaType: "movie" | "tv";
  tmdbId: number;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  language?: string;
  // Filters results to those whose release name contains this text
  // (e.g. "bluray") — filtered by the backend over one already-fetched
  // result set, not a separate OpenSubtitles-side search.
  query?: string;
  // 1-based; omit for the first page.
  page?: number;
};

export type OnlineSubtitleSearchResult = {
  results: OnlineSubtitleResult[];
  hasMore: boolean;
};

export type OnlineSubtitleDownloadParams = {
  mediaType: "movie" | "tv";
  tmdbId: number;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  fileId: number;
  language: string;
  label: string;
};

export type WatchProgressPayload = {
  tmdb_id: number;
  media_type: "movie" | "tv";
  season_number?: number | null;
  episode_number?: number | null;
  position_seconds: number;
  duration_seconds: number;
};

export type WatchProgress = {
  tmdb_id: number;
  media_type: "movie" | "tv";
  season_number: number | null;
  episode_number: number | null;
  position_seconds: number;
  duration_seconds: number;
};

async function handle<T>(res: Response, fallbackMessage: string): Promise<T> {
  if (!res.ok) {
    let detail = fallbackMessage;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      // ignore — use fallback
    }
    throw new Error(detail);
  }
  return res.json();
}

// NOTE: getMoviePlaybackSource/getEpisodePlaybackSource used to live
// here, but they're only ever called from Server Components during
// SSR (the watch pages), where plain fetch() has no browser cookie
// jar to attach — credentials:"include" is a no-op server-side. They
// now live in lib/playback-server.ts, which forwards the incoming
// request's cookies explicitly via next/headers, same pattern as
// getServerCurrentUser() in lib/session.ts. Everything below this
// point IS genuinely client-only (called from VideoPlayer /
// useWatchProgress), where the browser attaches cookies for us.

/**
 * Normal save path — used for the periodic autosave and on pause/seek,
 * where we're confident the page will stay alive long enough for a
 * regular fetch to complete.
 */
export async function saveWatchProgress(payload: WatchProgressPayload): Promise<void> {
  await fetch(`${getApiBaseUrl()}/watch-progress`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/**
 * Save path for when the page is being torn down (tab close,
 * navigation away, backgrounding). A normal fetch can be killed
 * mid-flight in these moments; sendBeacon is a browser API built
 * specifically to reliably deliver a small payload even as the page
 * unloads. Cookies (for auth) are included automatically for
 * same-origin beacons, but since our API may be on a different origin
 * in dev, this relies on CORS + credentials being configured for the
 * beacon's implicit request — acceptable here since it's best-effort
 * by nature (see useWatchProgress's periodic autosave as the primary
 * mechanism; this is a last-chance top-up, not the only save).
 */
export function saveWatchProgressBeacon(payload: WatchProgressPayload): void {
  if (typeof navigator === "undefined" || !navigator.sendBeacon) {
    // Fallback for browsers without sendBeacon support (very rare
    // today) — best effort, may not complete before the page closes.
    void saveWatchProgress(payload);
    return;
  }
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  navigator.sendBeacon(`${getApiBaseUrl()}/watch-progress`, blob);
}

// CLIENT-ONLY: like the save functions above, these rely on the
// browser attaching cookies automatically. If a future Server
// Component needs watch progress (e.g. a "Continue Watching" badge on
// a detail page), add a cookie-forwarding version in
// lib/playback-server.ts instead of calling these directly server-side.
export async function getMovieWatchProgress(tmdbId: number | string): Promise<WatchProgress | null> {
  const res = await fetch(`${getApiBaseUrl()}/watch-progress/movie/${tmdbId}`, {
    credentials: "include",
    cache: "no-store",
  });
  return handle(res, "Couldn't load watch progress.");
}

export async function getEpisodeWatchProgress(
  tmdbId: number | string,
  season: number,
  episode: number
): Promise<WatchProgress | null> {
  const res = await fetch(`${getApiBaseUrl()}/watch-progress/tv/${tmdbId}/${season}/${episode}`, {
    credentials: "include",
    cache: "no-store",
  });
  return handle(res, "Couldn't load watch progress.");
}

// Backs the TV detail page's "Watch Now" button (Phase 7 follow-up):
// the most recent episode this user has any progress on, across every
// season, or null if they've never started the show.
export async function getLatestTVWatchProgress(tmdbId: number | string): Promise<WatchProgress | null> {
  const res = await fetch(`${getApiBaseUrl()}/watch-progress/tv/${tmdbId}/latest`, {
    credentials: "include",
    cache: "no-store",
  });
  return handle(res, "Couldn't load watch progress.");
}

// Backs the episode list's "you've seen this one" highlighting: every
// episode of this season with any saved progress, finished or not.
export async function getSeasonWatchProgress(
  tmdbId: number | string,
  season: number
): Promise<WatchProgress[]> {
  const query = new URLSearchParams({ season_number: String(season) });
  const res = await fetch(`${getApiBaseUrl()}/watch-progress/tv/${tmdbId}/season-progress?${query}`, {
    credentials: "include",
    cache: "no-store",
  });
  return handle(res, "Couldn't load watch progress.");
}

// Phase 5b — online subtitle discovery (OpenSubtitles, proxied through
// our backend so the API key never reaches the browser).
export async function searchOnlineSubtitles(
  params: OnlineSubtitleSearchParams
): Promise<OnlineSubtitleSearchResult> {
  const query = new URLSearchParams({ media_type: params.mediaType, tmdb_id: String(params.tmdbId) });
  if (params.seasonNumber != null) query.set("season_number", String(params.seasonNumber));
  if (params.episodeNumber != null) query.set("episode_number", String(params.episodeNumber));
  if (params.language) query.set("language", params.language);
  if (params.query) query.set("query", params.query);
  if (params.page) query.set("page", String(params.page));

  const res = await fetch(`${getApiBaseUrl()}/subtitles/search?${query.toString()}`, {
    credentials: "include",
    cache: "no-store",
  });
  const data = await handle<{ results: OnlineSubtitleResult[]; has_more: boolean }>(
    res,
    "Couldn't search for subtitles."
  );
  return { results: data.results, hasMore: data.has_more };
}

export async function downloadOnlineSubtitle(params: OnlineSubtitleDownloadParams): Promise<SubtitleTrack> {
  const res = await fetch(`${getApiBaseUrl()}/subtitles/download`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      media_type: params.mediaType,
      tmdb_id: params.tmdbId,
      season_number: params.seasonNumber ?? null,
      episode_number: params.episodeNumber ?? null,
      file_id: params.fileId,
      language: params.language,
      label: params.label,
    }),
  });
  return handle(res, "Couldn't download that subtitle file.");
}
