import { cookies } from "next/headers";
import { getApiBaseUrl } from "@/lib/api-client";
import type { MediaItem } from "@/lib/media";

/**
 * ContinueWatchingItemOut on the backend deliberately mirrors MediaItem's
 * shape (see lib/watchlist.ts's WatchlistItem for the same reasoning),
 * plus the season/episode identity and raw progress numbers needed to
 * resume at the exact point and, for TV, show an "S{season}:E{episode}"
 * hint. Formatting that hint is done in the components that render
 * these (see components/ContinueWatchingRow.tsx) — this type just
 * carries the raw identity, matching the backend's schema.
 */
export type ContinueWatchingItem = MediaItem & {
  season_number: number | null;
  episode_number: number | null;
  position_seconds: number;
  duration_seconds: number;
};

/**
 * Server-only fetcher — the home page (a Server Component) and the
 * "View All" page are currently the only consumers, so there's no
 * client-side (lib/continue-watching.ts, no "-server" suffix)
 * counterpart yet. See lib/watchlist-server.ts / PHASE_HANDOFF.md §3.3
 * for why a Server Component needs its own cookie-forwarding fetcher
 * rather than the browser `fetch` pattern: a Node-side fetch has no
 * access to the browser's cookie jar, so `credentials: "include"`
 * silently does nothing there.
 *
 * limit defaults to 24 — the home page's single-row display cap — so
 * the common call site needs no argument at all; the "View All" page
 * passes a larger explicit limit.
 */
export async function getContinueWatchingServer(
  limit = 24
): Promise<{ items: ContinueWatchingItem[]; hasMore: boolean }> {
  const store = await cookies();
  const res = await fetch(`${getApiBaseUrl()}/continue-watching?limit=${limit}`, {
    headers: { Cookie: store.toString() },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error("Couldn't load Continue Watching.");
  }
  const data = await res.json();
  return { items: data.items, hasMore: data.has_more };
}
