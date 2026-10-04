import Link from "next/link";
import { getTrending, getPopularMovies, getPopularTV, type MediaItem } from "@/lib/media";
import { getContinueWatchingServer, type ContinueWatchingItem } from "@/lib/continue-watching-server";
import HeroCarousel from "@/components/HeroCarousel";
import MediaGrid from "@/components/MediaGrid";
import MediaRow from "@/components/MediaRow";
import { getServerSettings } from "@/lib/settings-server";
import ErrorState from "@/components/ErrorState";

// Generic over T (not hardcoded to MediaItem) so a caller passing a
// loader for a richer shape — e.g. ContinueWatchingItem, which extends
// MediaItem with season/episode/progress fields — gets those fields
// back out intact instead of erased to the base MediaItem type.
async function safeLoad<T extends MediaItem>(
  loader: () => Promise<T[]>
): Promise<{ items: T[]; error: string | null }> {
  try {
    return { items: await loader(), error: null };
  } catch {
    return { items: [], error: "Couldn't load this right now. Try refreshing in a moment." };
  }
}

export type GridItem = MediaItem & { href?: string; badge?: string };

export function Section({
  title,
  items,
  error,
  max = 24,
  viewAllHref,
  layout = "grid",
}: {
  title: string;
  items: GridItem[];
  error: string | null;
  // Trending/Popular are curated top-N lists, so 24 (a clean multiple
  // of the 2/4/6-column breakpoints) makes sense there. Continue
  // Watching also uses 24 (matching the backend's default fetch size —
  // see getContinueWatchingServer), with viewAllHref covering the case
  // where more than that exist.
  max?: number;
  // Shown as a small link next to the title when there may be more
  // items than this row displays — currently only Continue Watching
  // uses this, but any future section can.
  viewAllHref?: string;
  // "grid" (the classic wrapped grid) or "rows" (one swipeable row);
  // from Settings → Appearance → Home layout.
  layout?: "grid" | "rows";
}) {
  if (error) return null; // fail quietly per-section rather than break the whole page
  if (items.length === 0) return null;

  // The backend now fetches a second TMDB page when needed so there are
  // actually `max` available to show for the curated sections, not just
  // whatever a single page of 20 happens to return.
  const visible = items.slice(0, max);

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-lg font-medium text-white/90">{title}</h2>
        {viewAllHref && (
          <Link href={viewAllHref} className="text-sm text-white/50 hover:text-white/80">
            View All
          </Link>
        )}
      </div>
      {layout === "rows" ? <MediaRow items={visible} label={title} /> : <MediaGrid items={visible} />}
    </section>
  );
}

// Formats a stored resume point as "S{season}:E{episode}" — display
// formatting only, kept out of the API response on purpose (the
// backend stores/returns identity, not display text; see
// PHASE_HANDOFF.md §3.3 and schemas/continue_watching.py).
export function seasonEpisodeLabel(item: ContinueWatchingItem): string | null {
  if (item.season_number == null || item.episode_number == null) return null;
  return `S${item.season_number}:E${item.episode_number}`;
}

// The direct resume-playback URL for a Continue Watching item — same
// /watch/... routes DetailActions' "Watch Now" button already uses,
// just pointed at the exact remembered episode for TV.
export function resumeHref(item: ContinueWatchingItem): string {
  if (item.media_type === "movie") return `/watch/movie/${item.tmdb_id}`;
  return `/watch/tv/${item.tmdb_id}/${item.season_number}/${item.episode_number}`;
}

// One unified list — movies and series together, sorted by recency
// (already the order the backend returns them in). Every tile links
// straight to its resume point instead of the detail page; a series
// additionally gets a small "S{season}:E{episode}" poster badge so it's
// clear exactly where you left off, without a separate section or the
// heavier "Watch Now — S1:E3" call-to-action text this replaced.
export function toContinueWatchingItems(items: ContinueWatchingItem[]): GridItem[] {
  return items.map((item) => ({
    ...item,
    href: resumeHref(item),
    badge: seasonEpisodeLabel(item) ?? undefined,
  }));
}

export default async function Home() {
  // All five requests start together. Continue Watching used to be
  // awaited *after* the other four, so its (sometimes multi-second,
  // uncached-TMDB) lookup was added on top of theirs instead of
  // overlapping — the main reason the home skeleton hung around.
  //
  // Continue Watching isn't wrapped in safeLoad: its response shape is
  // {items, hasMore} rather than a bare array, so it carries hasMore
  // through with its own small catch. Not logged-in / nothing in
  // progress both surface as an empty list, and Section already renders
  // nothing for that case, same as every other row.
  const [today, week, movies, tv, continueWatching, settings] = await Promise.all([
    safeLoad(() => getTrending("day")),
    safeLoad(() => getTrending("week")),
    safeLoad(() => getPopularMovies()),
    safeLoad(() => getPopularTV()),
    getContinueWatchingServer().catch(() => ({ items: [] as ContinueWatchingItem[], hasMore: false })),
    getServerSettings(),
  ]);
  const { home_layout: layout, items_per_section: max } = settings.appearance;

  const heroUnavailable = today.error && week.error;

  return (
    <div className="animate-fade-in flex flex-col gap-10">
      {heroUnavailable && (
        <ErrorState compact message="Couldn't load trending right now. Try refreshing in a moment." />
      )}

      <HeroCarousel items={today.items.length > 0 ? today.items : week.items} />

      <Section
        title="Continue Watching"
        items={toContinueWatchingItems(continueWatching.items)}
        error={null}
        viewAllHref={continueWatching.hasMore || continueWatching.items.length > max ? "/continue-watching" : undefined}
        max={max}
        layout={layout}
      />
      <Section title="Trending Today" items={today.items} error={today.error} max={max} layout={layout} />
      <Section title="Trending This Week" items={week.items} error={week.error} max={max} layout={layout} />
      <Section title="Popular Movies" items={movies.items} error={movies.error} max={max} layout={layout} />
      <Section title="Popular TV Shows" items={tv.items} error={tv.error} max={max} layout={layout} />
    </div>
  );
}
