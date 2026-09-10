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

export async function getMoviePlaybackSource(tmdbId: number | string): Promise<PlaybackSource> {
  const res = await fetch(`${getApiBaseUrl()}/playback/movie/${tmdbId}`, {
    credentials: "include",
    cache: "no-store",
  });
  return handle(res, "Playback isn't available right now.");
}

export async function getEpisodePlaybackSource(
  tmdbId: number | string,
  season: number,
  episode: number
): Promise<PlaybackSource> {
  const res = await fetch(`${getApiBaseUrl()}/playback/tv/${tmdbId}/${season}/${episode}`, {
    credentials: "include",
    cache: "no-store",
  });
  return handle(res, "Playback isn't available right now.");
}

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
