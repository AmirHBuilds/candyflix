import { getTrending, getPopularMovies, getPopularTV, type MediaItem } from "@/lib/media";
import HeroCarousel from "@/components/HeroCarousel";
import MediaGrid from "@/components/MediaGrid";

async function safeLoad(
  loader: () => Promise<MediaItem[]>
): Promise<{ items: MediaItem[]; error: string | null }> {
  try {
    return { items: await loader(), error: null };
  } catch {
    return { items: [], error: "Couldn't load this right now. Try refreshing in a moment." };
  }
}

export function Section({
  title,
  items,
  error,
}: {
  title: string;
  items: MediaItem[];
  error: string | null;
}) {
  if (error) return null; // fail quietly per-section rather than break the whole page
  if (items.length === 0) return null;

  // Cap at 24 — a common multiple of the 2/4/6-column grid breakpoints —
  // so these curated sections always end on a complete row instead of a
  // partial one. TMDB's trending/popular lists are already ranked by
  // popularity, so taking the top 24 is a sensible editorial cut, not an
  // arbitrary one. The backend now fetches a second TMDB page when
  // needed so there are actually 24 available to show, not just
  // whatever a single page of 20 happens to return.
  const visible = items.slice(0, 24);

  return (
    <section>
      <h2 className="mb-3 text-lg font-medium text-white/90">{title}</h2>
      <MediaGrid items={visible} />
    </section>
  );
}

export default async function Home() {
  const [today, week, movies, tv] = await Promise.all([
    safeLoad(() => getTrending("day")),
    safeLoad(() => getTrending("week")),
    safeLoad(() => getPopularMovies()),
    safeLoad(() => getPopularTV()),
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

      <Section title="Trending Today" items={today.items} error={today.error} />
      <Section title="Trending This Week" items={week.items} error={week.error} />
      <Section title="Popular Movies" items={movies.items} error={movies.error} />
      <Section title="Popular TV Shows" items={tv.items} error={tv.error} />
    </div>
  );
}
