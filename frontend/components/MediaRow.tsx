import MediaCard from "@/components/MediaCard";
import type { MediaItem } from "@/lib/media";

export default function MediaRow({ title, items }: { title: string; items: MediaItem[] }) {
  if (items.length === 0) return null;

  return (
    <section>
      <h2 className="mb-3 text-lg font-medium text-white/90">{title}</h2>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {items.map((item) => (
          <MediaCard key={`${item.media_type}-${item.tmdb_id}`} item={item} />
        ))}
      </div>
    </section>
  );
}
