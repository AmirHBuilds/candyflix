import MediaCard from "@/components/MediaCard";
import type { MediaItem } from "@/lib/media";

// Optional per-item overrides, passed straight through to MediaCard.
// Plain MediaItem[] (every existing caller) is still assignable here —
// this only adds fields, it doesn't require them. Introduced for
// Continue Watching (Phase 7), which needs each tile to link straight
// to its resume point, with a small season/episode badge for series,
// rather than forking a whole new grid component for it.
type GridItem = MediaItem & { href?: string; badge?: string };

// Shared with the loading skeletons (components/Skeleton.tsx) so a
// skeleton grid always has exactly the same columns as the real one.
// The long comment on the breakpoints lives at the use site below.
export const MEDIA_GRID_CLASSES =
  "grid grid-cols-2 gap-x-3 gap-y-6 min-[1000px]:grid-cols-4 min-[1000px]:gap-x-4 min-[1280px]:grid-cols-6";

export default function MediaGrid({
  items,
  onNavigate,
}: {
  items: GridItem[];
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
    <div className={MEDIA_GRID_CLASSES}>
      {items.map((item, index) => (
        // Cards ease in with a short stagger (capped, so a long list or
        // a "Load More" batch never feels slow). The animation is
        // disabled for people who prefer reduced motion — see globals.css.
        <div
          key={`${item.media_type}-${item.tmdb_id}`}
          className="animate-fade-up min-w-0"
          style={{ animationDelay: `${Math.min(index, 11) * 30}ms` }}
        >
          <MediaCard item={item} onNavigate={onNavigate} href={item.href} badge={item.badge} />
        </div>
      ))}
    </div>
  );
}
