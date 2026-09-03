import { getTrending } from "@/lib/media";
import MediaGrid from "@/components/MediaGrid";

export default async function SeriesPage() {
  let items: Awaited<ReturnType<typeof getTrending>> = [];
  let error: string | null = null;

  try {
    const trending = await getTrending();
    items = trending.filter((i) => i.media_type === "tv");
  } catch {
    error = "Couldn't load series right now. Try refreshing in a moment.";
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold">
        Series
      </h1>
      {error && <p className="text-[#FF5FA2]">{error}</p>}
      {!error && items.length === 0 && (
        <p className="text-white/50">Nothing trending right now.</p>
      )}
      <MediaGrid items={items} />
    </div>
  );
}
