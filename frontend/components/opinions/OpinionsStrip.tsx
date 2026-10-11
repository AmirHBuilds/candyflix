"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import { HeartIcon } from "@/components/opinions/TitleLikeButton";
import { posterUrl } from "@/lib/media";
import { getFeed, type Feed, type FeedLike, type FeedOpinion } from "@/lib/opinions";

const hrefFor = (x: { media_type: string; tmdb_id: number }) => `/${x.media_type}/${x.tmdb_id}`;

function Poster({ path, title }: { path: string | null; title: string }) {
  const src = posterUrl(path, "w342");
  return (
    <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl bg-white/5">
      {src && <Image src={src} alt={title} fill sizes="168px" className="object-cover transition-transform duration-300 group-hover:scale-[1.03]" />}
    </div>
  );
}

function OpinionCard({ o }: { o: FeedOpinion }) {
  const who = o.author?.name ?? "Someone";
  return (
    <Link href={hrefFor(o)} className="group flex w-[148px] shrink-0 snap-start flex-col gap-2 sm:w-[168px]">
      <Poster path={o.poster_path} title={o.title} />
      <p className="line-clamp-3 break-words text-sm leading-snug text-white/85">“{o.body}”</p>
      <p className="flex items-center gap-1.5 text-xs text-white/50">
        {o.author && <Avatar name={who} src={o.author.avatar_url} size={16} />}
        <span className="truncate">{who}</span>
        {o.likes > 0 && (
          <span className="ml-auto flex shrink-0 items-center gap-1 text-accent">
            <HeartIcon filled className="h-3 w-3" />
            {o.likes}
          </span>
        )}
      </p>
    </Link>
  );
}

function likeText(l: FeedLike): string {
  const names = l.people.map((p) => p.name);
  const list = names.length > 1 && l.more === 0 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names.join(", ");
  return `${list}${l.more > 0 ? ` + ${l.more}` : ""} liked this`;
}

function LikeCard({ l }: { l: FeedLike }) {
  return (
    <Link href={hrefFor(l)} className="group flex w-[148px] shrink-0 snap-start flex-col gap-2 sm:w-[168px]">
      <Poster path={l.poster_path} title={l.title} />
      <p className="flex items-start gap-1.5 text-sm leading-snug text-white/70">
        <HeartIcon filled className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
        <span className="line-clamp-2">{likeText(l)}</span>
      </p>
    </Link>
  );
}

/** "What people are saying": one quiet row of the family's latest opinions and likes, in the same card size as the other rows. */
export default function OpinionsStrip() {
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

  if (!feed || !feed.enabled || (feed.opinions.length === 0 && feed.likes.length === 0)) return null;
  return (
    <section aria-label="What people are saying">
      <h2 className="mb-3 text-lg font-medium text-white/90">What people are saying</h2>
      <div className="-mx-6 flex snap-x gap-4 overflow-x-auto px-6 pb-2 [scrollbar-width:none] sm:mx-0 sm:px-0">
        {feed.opinions.map((o) => (
          <OpinionCard key={o.id} o={o} />
        ))}
        {feed.likes.map((l) => (
          <LikeCard key={`${l.media_type}-${l.tmdb_id}-${l.season_number}-${l.episode_number}`} l={l} />
        ))}
      </div>
    </section>
  );
}
