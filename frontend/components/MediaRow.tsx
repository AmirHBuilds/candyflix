"use client";

import { useRef } from "react";
import MediaCard from "@/components/MediaCard";
import type { MediaItem } from "@/lib/media";

type RowItem = MediaItem & { href?: string; badge?: string };

/**
 * One swipeable row (Settings → Appearance → Home layout: "Swipe rows").
 * Native horizontal scrolling with scroll-snap, so a thumb flick just
 * works; on devices with a mouse, arrow buttons appear on hover.
 */
export default function MediaRow({ items, label }: { items: RowItem[]; label: string }) {
  const scroller = useRef<HTMLUListElement>(null);

  function page(direction: 1 | -1) {
    const el = scroller.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.85, behavior: "smooth" });
  }

  return (
    <div className="group/row relative -mx-6 sm:-mx-10">
      <ul
        ref={scroller}
        aria-label={label}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-6 px-6 pb-2 sm:scroll-px-10 sm:px-10 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item) => (
          <li
            key={`${item.media_type}-${item.tmdb_id}`}
            className="w-[42%] shrink-0 snap-start min-[640px]:w-[28%] min-[1000px]:w-[19%] min-[1280px]:w-[15%]"
          >
            <MediaCard item={item} href={item.href} badge={item.badge} />
          </li>
        ))}
      </ul>
      {(["prev", "next"] as const).map((dir) => (
        <button
          key={dir}
          type="button"
          aria-label={dir === "prev" ? `Scroll ${label} left` : `Scroll ${label} right`}
          onClick={() => page(dir === "prev" ? -1 : 1)}
          className={`pointer-coarse:hidden absolute top-[38%] z-10 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-xl text-white opacity-0 backdrop-blur transition-opacity hover:bg-black/80 focus-visible:opacity-100 group-hover/row:opacity-100 sm:flex ${
            dir === "prev" ? "left-3" : "right-3"
          }`}
        >
          {dir === "prev" ? "‹" : "›"}
        </button>
      ))}
    </div>
  );
}
