import { cookies } from "next/headers";
import { getApiBaseUrl } from "@/lib/api-client";
import type { WatchlistItem } from "@/lib/watchlist";

/**
 * Server-side counterpart to lib/watchlist.ts's getWatchlist(), for the
 * Candy Box page (a Server Component). See playback-server.ts for why
 * this needs its own cookie-forwarding fetcher rather than reusing the
 * client version directly.
 */
async function forwardedCookieHeader(): Promise<string> {
  const store = await cookies();
  return store.toString();
}

export async function getWatchlistServer(): Promise<WatchlistItem[]> {
  const res = await fetch(`${getApiBaseUrl()}/watchlist`, {
    headers: { Cookie: await forwardedCookieHeader() },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error("Couldn't load your Candy Box.");
  }
  return res.json();
}
