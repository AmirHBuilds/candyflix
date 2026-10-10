"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import { posterUrl } from "@/lib/media";
import { getFeed, type Feed, type FeedLike, type FeedOpinion } from "@/lib/opinions";

const ROTATE_MS = 8000;

const hrefFor = (x: { media_type: string; tmdb_id: number }) => `/${x.media_type}/${x.tmdb_id}`;

function likeChipText(l: FeedLike): string {
  const names = l.people.map((p) => p.name);
  const list = names.length > 1 && l.more === 0 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names.join(", ");
  return `${list}${l.more > 0 ? ` + ${l.more}` : ""} liked ${l.title}`;
}

function QuoteCard({ o }: { o: FeedOpinion }) {
  const poster = posterUrl(o.poster_path, "w342");
  const who = o.author?.name ?? "Someone";
  return (
    <Link
      href={hrefFor(o)}
      className="animate-drift-in flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-3 transition-colors hover:bg-white/[0.07]"
    >
      {poster && <Image src={poster} alt="" width={56} height={84} className="h-[84px] w-14 shrink-0 rounded-lg object-cover" />}
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 break-words text-base text-white/90">“{o.body}”</p>
        <div className="mt-1.5 flex items-center gap-2 text-xs text-white/50">
          {o.author ? <Avatar name={who} src={o.author.avatar_url} size={18} /> : null}
          <span>
            {who} on <span className="text-white/70">{o.title}</span>
          </span>
          {o.likes > 0 && <span className="text-accent">♥ {o.likes}</span>}
        </div>
      </div>
    </Link>
  );
}

/** "From the family": one calm card that changes every few seconds, plus small "X liked Y" chips. Renders nothing when empty or switched off. */
export default function OpinionsStrip() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    let live = true;
    getFeed()
      .then((f) => live && setFeed(f))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const count = feed?.opinions.length ?? 0;
  useEffect(() => {
    if (count < 2 || paused) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % count), ROTATE_MS);
    return () => clearInterval(t);
  }, [count, paused]);

  if (!feed || !feed.enabled || (feed.opinions.length === 0 && feed.likes.length === 0)) return null;
  const current = feed.opinions[index % Math.max(1, count)];

  return (
    <section aria-label="From the family" className="flex flex-col gap-3" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <h2 className="text-lg font-medium text-white/90">From the family</h2>
      {current && (
        <div>
          <QuoteCard key={current.id} o={current} />
          {count > 1 && (
            <div className="mt-2 flex justify-center gap-1.5" role="tablist" aria-label="More opinions">
              {feed.opinions.map((o, i) => (
                <button
                  key={o.id}
                  type="button"
                  role="tab"
                  aria-selected={i === index % count}
                  aria-label={`Opinion ${i + 1}`}
                  onClick={() => setIndex(i)}
                  className={`h-1.5 rounded-full transition-all ${i === index % count ? "w-5 bg-accent" : "w-1.5 bg-white/25"}`}
                />
              ))}
            </div>
          )}
        </div>
      )}
      {feed.likes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {feed.likes.map((l) => (
            <Link
              key={`${l.media_type}-${l.tmdb_id}-${l.season_number}-${l.episode_number}`}
              href={hrefFor(l)}
              className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/65 transition-colors hover:text-white"
            >
              <span className="text-accent">♥</span> {likeChipText(l)}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
