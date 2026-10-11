"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import { MEDIA_GRID_CLASSES } from "@/components/MediaGrid";
import { HeartIcon } from "@/components/opinions/TitleLikeButton";
import { detailHref, posterUrl } from "@/lib/media";
import { getFeed, likeSentence, whereLabel, type Feed, type FeedTitle } from "@/lib/opinions";

export const FAMILY_ROW_TITLE = "Family favorites";

const href = (t: FeedTitle) => detailHref({ media_type: t.media_type, tmdb_id: t.tmdb_id } as never);

/**
 * One title, with what the family did on it kept under the poster: the newest opinion (clipped), how many more
 * there are, and who liked it. Quiet on purpose: small type, no boxes.
 */
function FamilyCard({ t }: { t: FeedTitle }) {
  const poster = posterUrl(t.poster_path, "w500");
  const latest = t.latest;
  const who = latest?.author?.name ?? "Someone";
  const where = latest ? whereLabel(latest) : null;
  const others = t.comment_count - 1;
  const liked = likeSentence({ ...t.likes, you_liked: false }).replace(/ liked this$/, " liked it");
  return (
    <Link href={href(t)} className="group block w-full min-w-0">
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-white/5 ring-1 ring-white/10 transition-all duration-200 group-hover:ring-accent/50">
        {poster ? (
          <Image src={poster} alt={t.title} fill sizes="(min-width: 1024px) 16vw, (min-width: 640px) 25vw, 50vw" className="object-cover transition-transform duration-300 group-hover:scale-105" />
        ) : (
          <div className="flex h-full items-center justify-center px-3 text-center text-sm text-white/40">{t.title}</div>
        )}
        {t.comment_count > 0 && (
          <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/65 px-2 py-0.5 text-[11px] font-medium text-white/90 backdrop-blur-sm">
            <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
            </svg>
            {t.comment_count}
          </span>
        )}
      </div>
      <p className="mt-2 truncate text-sm text-white/80">{t.title}</p>
      {latest && (
        <div className="mt-1">
          <p className="line-clamp-2 break-words text-xs italic leading-snug text-white/65">“{latest.body}”</p>
          <p className="mt-0.5 truncate text-[11px] text-white/40">
            {who}
            {where ? ` · ${where}` : ""}
            {others > 0 ? ` · +${others} more ${others === 1 ? "comment" : "comments"}` : ""}
          </p>
        </div>
      )}
      {t.likes.count > 0 && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-white/50">
          <span className="flex -space-x-1.5">
            {t.likes.people.map((p) => (
              <Avatar key={p.id} name={p.name} src={p.avatar_url} size={16} className="ring-2 ring-canvas" />
            ))}
          </span>
          <HeartIcon filled className="h-3 w-3 shrink-0 text-accent" />
          <span className="truncate">{liked}</span>
        </p>
      )}
    </Link>
  );
}

/** A home row like the others (grid or swipe, as chosen in Settings): the titles your people commented on or liked. */
export default function OpinionsStrip({ layout = "grid", max = 24 }: { layout?: "grid" | "rows"; max?: number }) {
  const [feed, setFeed] = useState<Feed | null>(null);

  useEffect(() => {
    let live = true;
    getFeed()
      .then((f) => live && setFeed(f))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (!feed || !feed.enabled || feed.items.length === 0) return null;
  const items = feed.items.slice(0, max);
  return (
    <section aria-label={FAMILY_ROW_TITLE}>
      <h2 className="mb-3 text-lg font-medium text-white/90">{FAMILY_ROW_TITLE}</h2>
      {layout === "rows" ? (
        <div className="-mx-6 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-6 px-6 pb-2 sm:-mx-10 sm:scroll-px-10 sm:px-10 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {items.map((t) => (
            <div key={`${t.media_type}-${t.tmdb_id}`} className="w-[42%] shrink-0 snap-start min-[640px]:w-[28%] min-[1000px]:w-[19%] min-[1280px]:w-[15%]">
              <FamilyCard t={t} />
            </div>
          ))}
        </div>
      ) : (
        <div className={MEDIA_GRID_CLASSES}>
          {items.map((t) => (
            <div key={`${t.media_type}-${t.tmdb_id}`} className="min-w-0">
              <FamilyCard t={t} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
