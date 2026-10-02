import { getContinueWatchingServer } from "@/lib/continue-watching-server";
import { toContinueWatchingItems } from "@/app/(main)/page";
import MediaGrid from "@/components/MediaGrid";
import EmptyState from "@/components/EmptyState";
import ErrorState from "@/components/ErrorState";

// The home page's row is capped at 24 with a "View All" link appearing
// only when there's more than that (see Section's viewAllHref in
// app/(main)/page.tsx). This page is where that link goes, so it asks
// for everything the backend will give back in one page (200 — its
// upper bound; see the `limit` Query(..., le=200) on the
// /continue-watching route) rather than repeating the home page's cap.
const VIEW_ALL_LIMIT = 200;

export default async function ContinueWatchingPage() {
  let items: Awaited<ReturnType<typeof getContinueWatchingServer>>["items"] = [];
  let error: string | null = null;
  try {
    ({ items } = await getContinueWatchingServer(VIEW_ALL_LIMIT));
  } catch {
    error = "Couldn't load Continue Watching right now. Try refreshing in a moment.";
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-white">
        Continue Watching
      </h1>

      {error ? (
        <ErrorState message={error} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="play"
          title="Nothing in progress"
          message="Start watching something and it'll show up here, ready to pick up where you left off."
          action={{ label: "Find something to watch", href: "/" }}
        />
      ) : (
        <MediaGrid items={toContinueWatchingItems(items)} />
      )}
    </div>
  );
}
