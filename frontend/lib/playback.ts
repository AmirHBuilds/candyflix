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
  updated_at: string;
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
    // Without this, a save fired right before navigating to a
    // different episode can be silently killed mid-flight: clicking an
    // episode link navigates immediately, and a plain fetch from the
    // page being left doesn't get to finish. That's exactly the bug
    // this fixes — quickly clicking through several episodes could
    // leave the "high-water mark" stuck on an old episode, because the
    // save for whatever you clicked through stopped short of ever
    // reaching the server, and only the separate pagehide/beacon path
    // (a different, later moment) eventually delivered a save, well
    // after the next page had already rendered with stale data.
    // `keepalive` tells the browser to let this request complete in
    // the background even after the initiating document is gone — the
    // same guarantee sendBeacon exists for below, just usable from an
    // ordinary fetch call with a JSON body. Total keepalive payload
    // size across the browser is capped (~64KB), far more than this
    // tiny JSON body needs.
    keepalive: true,
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
/**
 * Records "this episode was opened" — TV only — independent of any real
 * playback. Called the instant the watch page mounts, before the video
 * element (or useWatchProgress's own save logic) has done anything.
 *
 * Why this exists: even the "save immediately on play" behavior in
 * useWatchProgress needs the `play` event to actually fire, which needs
 * the video to have started — if someone clicks an episode and closes
 * it within a second, that might never happen, leaving no row at all.
 * The NEXT visit would then show the PREVIOUS episode as last watched,
 * as if the click had never happened — exactly the confusion this is
 * for. Fire-and-forget: a failed call just means this one open doesn't
 * register, same as if this function didn't exist.
 */
export function recordEpisodeVisit(tmdbId: number, seasonNumber: number, episodeNumber: number): void {
  void fetch(`${getApiBaseUrl()}/watch-progress/tv/visit`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tmdb_id: tmdbId, season_number: seasonNumber, episode_number: episodeNumber }),
    keepalive: true,
  }).catch(() => {
    // Best effort — see docstring above.
  });
}

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

/**
 * Flushes the CURRENTLY PLAYING episode's live position to the server —
 * awaited, not fire-and-forget — before navigating to href.
 *
 * Why this exists, given saveWatchProgress above already has
 * `keepalive: true`: keepalive only guarantees the request isn't killed
 * mid-flight by the navigation. It does NOT guarantee the request lands
 * — and commits in the database — before the page you're navigating TO
 * makes its own server-side "what's the latest episode?" request. Those
 * two HTTP requests (the outgoing save, the incoming page's read) race
 * each other with no ordering guarantee, so a fast click from one
 * episode to another could still show stale data on the very next page,
 * even though the save eventually, correctly lands moments later (which
 * is exactly the confusing "it looked wrong until I reloaded" behavior
 * this was built to fix).
 *
 * SUPERSEDED by navigateWithResumeHint below: awaiting the save here
 * closed the race correctly, but at the cost of blocking every episode
 * switch on a network round-trip — fine on a fast connection, badly
 * unresponsive on a slow or flaky one (a multi-second freeze just to
 * click to the next episode). navigateWithResumeHint gets the same
 * correctness without that cost. Kept as a named export in case a
 * future caller genuinely needs "guaranteed landed before navigating"
 * over responsiveness, but nothing in this app should reach for it by
 * default anymore.
 *
 * Reads live position directly from the <video> element rather than
 * threading a ref through props: there is exactly one <video> per page
 * in this app (see VideoPlayer.tsx), so this is safe.
 */
export async function flushWatchProgressAndNavigate(
  identity: {
    tmdbId: number;
    mediaType: "movie" | "tv";
    seasonNumber?: number | null;
    episodeNumber?: number | null;
  },
  href: string
): Promise<void> {
  const video = typeof document !== "undefined" ? document.querySelector("video") : null;
  if (video && Number.isFinite(video.duration) && video.duration > 0) {
    try {
      await saveWatchProgress({
        tmdb_id: identity.tmdbId,
        media_type: identity.mediaType,
        season_number: identity.seasonNumber ?? null,
        episode_number: identity.episodeNumber ?? null,
        position_seconds: video.currentTime,
        duration_seconds: video.duration,
      });
    } catch {
      // Best effort — a failed flush shouldn't trap someone on this
      // page; proceed to navigate regardless.
    }
  }
  window.location.href = href;
}

/**
 * Appends "you were just watching S{season}:E{episode}" as query params
 * onto href — TV only; a movie has no season/episode ordering to hint
 * at, so href is returned unchanged for a movie identity.
 */
function withResumeHint(
  href: string,
  identity: { mediaType: "movie" | "tv"; seasonNumber?: number | null; episodeNumber?: number | null }
): string {
  if (identity.mediaType !== "tv" || identity.seasonNumber == null || identity.episodeNumber == null) {
    return href;
  }
  const [path, existingQuery] = href.split("?");
  const params = new URLSearchParams(existingQuery);
  params.set("fromSeason", String(identity.seasonNumber));
  params.set("fromEpisode", String(identity.episodeNumber));
  return `${path}?${params.toString()}`;
}

/**
 * The practical replacement for flushWatchProgressAndNavigate: instead
 * of making the person wait for a network round-trip before switching
 * episodes, this saves in the background (fire-and-forget, protected by
 * saveWatchProgress's `keepalive`) and navigates immediately — but
 * tells the destination page what was just playing via a query-string
 * hint, so it doesn't have to guess or wait for that save to land
 * before it can show the right thing.
 *
 * Why this is correct, not just faster: the reason the earlier
 * await-then-navigate fix existed was to stop the destination page from
 * reading stale server data. But the destination page doesn't actually
 * need to ask the server at all for "what was I just watching" — the
 * PERSON clicking already knows the answer, because they're the one
 * doing the clicking. Passing that fact forward directly sidesteps the
 * race instead of racing to win it: there is no round-trip to be slow
 * or to lose a race against, so a slow connection no longer costs
 * anything in the UI. mergeResumeWithHint (below) is how the receiving
 * page combines this hint with whatever the server does eventually
 * confirm, so a slow/failed save still can't leave anything worse off
 * than before this existed — see its docstring for the actual merge
 * rule (a real save landing late will always at least match, never
 * undercut, what the hint already showed).
 */
export function navigateWithResumeHint(
  identity: {
    tmdbId: number;
    mediaType: "movie" | "tv";
    seasonNumber?: number | null;
    episodeNumber?: number | null;
  },
  href: string
): void {
  const video = typeof document !== "undefined" ? document.querySelector("video") : null;
  if (video && Number.isFinite(video.duration) && video.duration > 0) {
    void saveWatchProgress({
      tmdb_id: identity.tmdbId,
      media_type: identity.mediaType,
      season_number: identity.seasonNumber ?? null,
      episode_number: identity.episodeNumber ?? null,
      position_seconds: video.currentTime,
      duration_seconds: video.duration,
    }).catch(() => {
      // Best effort — the hint in the URL is what keeps the UI correct
      // for this navigation regardless; a failed background save just
      // means the *next* fresh page load (with no hint) falls back to
      // whatever the server last had, same as before any of this
      // existed.
    });
  }
  window.location.href = withResumeHint(href, identity);
}

/**
 * Combines a server-fetched resume point with an optional "you were
 * just watching S{season}:E{episode}" hint from the URL (see
 * navigateWithResumeHint) — used by the TV detail and watch pages right
 * after they fetch resumeEpisode from the server, so a hint from a
 * still-in-flight or not-yet-landed save doesn't get overridden by
 * stale server data.
 *
 * The rule is simply "whichever is ordinally further along wins" — the
 * same high-water-mark comparison the backend itself uses (see
 * get_latest_progress_for_title's docstring). The hint can only ever
 * move the shown resume point FORWARD relative to what the server
 * says, never backward: if the server already reflects something at or
 * past the hint (e.g. the save landed before this page's fetch after
 * all, or the person has since watched even further), the server's
 * answer is used untouched.
 */
export function mergeResumeWithHint(
  server: WatchProgress | null,
  hint: { seasonNumber: number; episodeNumber: number } | null,
  tmdbId: number
): WatchProgress | null {
  if (!hint) return server;

  const serverIsAtLeastAsFar =
    server != null &&
    server.season_number != null &&
    server.episode_number != null &&
    (server.season_number > hint.seasonNumber ||
      (server.season_number === hint.seasonNumber && server.episode_number >= hint.episodeNumber));
  if (serverIsAtLeastAsFar) return server;

  // The hint is further along than whatever the server currently knows
  // (or the server has no row for this show at all yet) — position and
  // duration are never read from the value this function returns (only
  // season_number/episode_number are, by DetailActions and
  // SeasonBrowser), so 0 is a safe placeholder rather than a real
  // position.
  return {
    tmdb_id: tmdbId,
    media_type: "tv",
    season_number: hint.seasonNumber,
    episode_number: hint.episodeNumber,
    position_seconds: 0,
    duration_seconds: 0,
    updated_at: new Date().toISOString(),
  };
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

/**
 * Parses the "you were just watching S{season}:E{episode}" hint (see
 * navigateWithResumeHint) out of a Next.js searchParams object. Kept
 * separate from mergeResumeWithHint so a page can parse once and merge
 * against more than one source if it ever needs to.
 */
export function parseResumeHintFromSearchParams(
  searchParams: Record<string, string | string[] | undefined>
): { seasonNumber: number; episodeNumber: number } | null {
  const seasonRaw = searchParams.fromSeason;
  const episodeRaw = searchParams.fromEpisode;
  const season = Array.isArray(seasonRaw) ? seasonRaw[0] : seasonRaw;
  const episode = Array.isArray(episodeRaw) ? episodeRaw[0] : episodeRaw;
  if (season == null || episode == null) return null;
  const seasonNumber = Number(season);
  const episodeNumber = Number(episode);
  if (!Number.isFinite(seasonNumber) || !Number.isFinite(episodeNumber)) return null;
  return { seasonNumber, episodeNumber };
}
