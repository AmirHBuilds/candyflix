import MediaCard from "@/components/MediaCard";
import type { MediaItem } from "@/lib/media";

export default function MediaGrid({ items }: { items: MediaItem[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {items.map((item) => (
        <MediaCard key={`${item.media_type}-${item.tmdb_id}`} item={item} />
      ))}
    </div>
  );
}
