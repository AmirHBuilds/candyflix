import { getServerCurrentUser } from "@/lib/session";
import { boxNameFor } from "@/lib/box-name";
import { getWatchlistServer } from "@/lib/watchlist-server";
import MediaGrid from "@/components/MediaGrid";
import EmptyState from "@/components/EmptyState";
import ErrorState from "@/components/ErrorState";

export default async function CandyBoxPage() {
  const user = await getServerCurrentUser().catch(() => null);
  const boxName = boxNameFor(user?.display_name);
  let items: Awaited<ReturnType<typeof getWatchlistServer>> = [];
  let error: string | null = null;
  try {
    items = await getWatchlistServer();
  } catch {
    error = `Couldn't load ${boxName} right now. Try refreshing in a moment.`;
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-white">
        {boxName}
      </h1>

      {error ? (
        <ErrorState message={error} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="box"
          title={`${boxName} is empty`}
          message={`Nothing saved yet. Tap “Add to ${boxName}” on any movie or show to save it here for later.`}
          action={{ label: "Browse movies", href: "/movies" }}
        />
      ) : (
        <MediaGrid items={items} />
      )}
    </div>
  );
}
