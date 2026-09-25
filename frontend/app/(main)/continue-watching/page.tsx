import { getContinueWatchingServer } from "@/lib/continue-watching-server";
import { toContinueWatchingItems } from "@/app/(main)/page";
import MediaGrid from "@/components/MediaGrid";

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
        <p className="py-24 text-center text-white/50">{error}</p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-24 text-center">
          <p className="max-w-sm text-white/50">
            Nothing in progress right now. Start watching something and it&apos;ll show up here.
          </p>
        </div>
      ) : (
        <MediaGrid items={toContinueWatchingItems(items)} />
      )}
    </div>
  );
}
