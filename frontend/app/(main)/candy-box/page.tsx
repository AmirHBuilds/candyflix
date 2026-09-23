import { getWatchlistServer } from "@/lib/watchlist-server";
import MediaGrid from "@/components/MediaGrid";

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
        <p className="py-24 text-center text-white/50">{error}</p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-24 text-center">
          <p className="max-w-sm text-white/50">
            Nothing saved yet. Tap &ldquo;Add to Candy Box&rdquo; on any movie or show to save it
            here for later.
          </p>
        </div>
      ) : (
        <MediaGrid items={items} />
      )}
    </div>
  );
}
