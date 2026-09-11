import { cookies } from "next/headers";
import { getApiBaseUrl } from "@/lib/api-client";
import type { PlaybackSource } from "@/lib/playback";

/**
 * Server-side counterpart to lib/playback.ts's fetchers. A Server
 * Component's fetch() runs in Node, which has no browser cookie jar —
 * credentials:"include" does nothing there. We read the incoming
 * request's cookies via next/headers and forward them explicitly,
 * exactly like getServerCurrentUser() in lib/session.ts already does.
 * These are the only playback fetchers safe to call from a Server
 * Component (the watch pages); everything in lib/playback.ts is
 * client-only.
 */
async function forwardedCookieHeader(): Promise<string> {
  const store = await cookies();
  return store.toString();
}

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

export async function getMoviePlaybackSourceServer(
  tmdbId: number | string
): Promise<PlaybackSource> {
  const res = await fetch(`${getApiBaseUrl()}/playback/movie/${tmdbId}`, {
    headers: { Cookie: await forwardedCookieHeader() },
    cache: "no-store",
  });
  return handle(res, "Playback isn't available right now.");
}

export async function getEpisodePlaybackSourceServer(
  tmdbId: number | string,
  season: number,
  episode: number
): Promise<PlaybackSource> {
  const res = await fetch(`${getApiBaseUrl()}/playback/tv/${tmdbId}/${season}/${episode}`, {
    headers: { Cookie: await forwardedCookieHeader() },
    cache: "no-store",
  });
  return handle(res, "Playback isn't available right now.");
}
