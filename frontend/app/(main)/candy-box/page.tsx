import { getWatchlistServer } from "@/lib/watchlist-server";
import MediaGrid from "@/components/MediaGrid";
import EmptyState from "@/components/EmptyState";
import ErrorState from "@/components/ErrorState";

export default async function CandyBoxPage() {
  let items: Awaited<ReturnType<typeof getWatchlistServer>> = [];
  let error: string | null = null;
  try {
    items = await getWatchlistServer();
  } catch {
    error = "Couldn't load your Candy Box right now. Try refreshing in a moment.";
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-white">
        Candy Box
      </h1>

      {error ? (
        <ErrorState message={error} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="box"
          title="Your Candy Box is empty"
          message="Nothing saved yet. Tap “Add to Candy Box” on any movie or show to save it here for later."
          action={{ label: "Browse movies", href: "/movies" }}
        />
      ) : (
        <MediaGrid items={items} />
      )}
    </div>
  );
}
