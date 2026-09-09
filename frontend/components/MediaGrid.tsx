import MediaCard from "@/components/MediaCard";
import type { MediaItem } from "@/lib/media";

export default function MediaGrid({
  items,
  onNavigate,
}: {
  items: MediaItem[];
  onNavigate?: () => void;
}) {
  // Breakpoints use exact pixel values (not Tailwind's lg/xl scale) so
  // they land where testing actually showed they should. The 4-column
  // switch is set at 1000px, not 1024px: a vertical scrollbar eats
  // ~15-17px of a browser window's content width, so a window resized to
  // exactly 1024px often reports a viewport just *under* 1024px to CSS —
  // missing a breakpoint set at the round number itself. 1000px keeps a
  // safety margin so it reliably switches by the time the window reads
  // ~1024px, scrollbar or not.
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-6 min-[1000px]:grid-cols-4 min-[1000px]:gap-x-4 min-[1280px]:grid-cols-6">
      {items.map((item) => (
        <MediaCard
          key={`${item.media_type}-${item.tmdb_id}`}
          item={item}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
}
