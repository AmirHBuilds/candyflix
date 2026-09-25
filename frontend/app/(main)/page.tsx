import { getTrending, getPopularMovies, getPopularTV, type MediaItem } from "@/lib/media";
import { getContinueWatchingServer, type ContinueWatchingItem } from "@/lib/continue-watching-server";
import HeroCarousel from "@/components/HeroCarousel";
import MediaGrid from "@/components/MediaGrid";

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

type GridItem = MediaItem & { href?: string; badge?: string; cta?: string };

export function Section({
  title,
  items,
  error,
  max = 24,
}: {
  title: string;
  items: GridItem[];
  error: string | null;
  // Trending/Popular are curated top-N lists, so 24 (a clean multiple
  // of the 2/4/6-column breakpoints) makes sense there. Continue
  // Watching is recency-based, not curated, and reads better as a
  // shorter, more "row-like" cut — callers pass a smaller max for it.
  max?: number;
}) {
  if (error) return null; // fail quietly per-section rather than break the whole page
  if (items.length === 0) return null;

  // The backend now fetches a second TMDB page when needed so there are
  // actually `max` available to show for the curated sections, not just
  // whatever a single page of 20 happens to return.
  const visible = items.slice(0, max);

  return (
    <section>
      <h2 className="mb-3 text-lg font-medium text-white/90">{title}</h2>
      <MediaGrid items={visible} />
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

export function toGeneralContinueWatchingItems(items: ContinueWatchingItem[]): GridItem[] {
  // The general row is deliberately plain — same look as every other
  // home row (poster, title, year · type · rating), just linking
  // straight to the resume point instead of the detail page. The
  // in-progress-series section below is where the extra "exactly where
  // you are" treatment (badge + CTA) lives, per the user's explicit ask.
  return items.map((item) => ({ ...item, href: resumeHref(item) }));
}

export function toSeriesContinueWatchingItems(items: ContinueWatchingItem[]): GridItem[] {
  return items
    .filter((item) => item.media_type === "tv")
    .map((item) => {
      const label = seasonEpisodeLabel(item);
      return {
        ...item,
        href: resumeHref(item),
        badge: label ?? undefined,
        cta: label ? `Watch Now — ${label}` : "Watch Now",
      };
    });
}

export default async function Home() {
  const [today, week, movies, tv, continueWatching] = await Promise.all([
    safeLoad(() => getTrending("day")),
    safeLoad(() => getTrending("week")),
    safeLoad(() => getPopularMovies()),
    safeLoad(() => getPopularTV()),
    // Continue Watching (Phase 7) — same safeLoad wrapper as the other
    // rows. Not logged-in / nothing in progress both surface as an
    // empty list here, and Section already renders nothing for that
    // case, same as every other row.
    safeLoad(() => getContinueWatchingServer()),
  ]);

  const heroUnavailable = today.error && week.error;

  return (
    <div className="flex flex-col gap-10">
      {heroUnavailable && (
        <p className="text-[#FF5FA2]">
          Couldn&apos;t load trending right now. Try refreshing in a moment.
        </p>
      )}

      <HeroCarousel items={today.items.length > 0 ? today.items : week.items} />

      <Section
        title="Continue Watching"
        items={toGeneralContinueWatchingItems(continueWatching.items)}
        error={continueWatching.error}
        max={12}
      />
      <Section
        title="Continue Watching: Series"
        items={toSeriesContinueWatchingItems(continueWatching.items)}
        error={continueWatching.error}
        max={8}
      />
      <Section title="Trending Today" items={today.items} error={today.error} />
      <Section title="Trending This Week" items={week.items} error={week.error} />
      <Section title="Popular Movies" items={movies.items} error={movies.error} />
      <Section title="Popular TV Shows" items={tv.items} error={tv.error} />
    </div>
  );
}
