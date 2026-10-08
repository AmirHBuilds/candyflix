"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { useBoxName } from "@/components/BoxNameProvider";
import Overview from "@/components/Overview";
import RatingsButton from "@/components/RatingsButton";
import TrailerButton from "@/components/TrailerButton";
import type { AskTitle } from "@/lib/ai";
import { detailHref, posterUrl } from "@/lib/media";
import { showToast } from "@/lib/toast";
import { addToWatchlist, removeFromWatchlist } from "@/lib/watchlist";

// One suggestion, laid out like a slim detail page: poster, title, year and length, ratings, trailer,
// genres, the AI's reason, the description, and the same Watch / Candy Box actions.
export default function AskResultRow({ item }: { item: AskTitle }) {
  const boxName = useBoxName();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const poster = posterUrl(item.poster_path, "w342");
  const href = detailHref(item);
  const watchHref = item.media_type === "movie" ? `/watch/movie/${item.tmdb_id}` : `/watch/tv/${item.tmdb_id}/1/1`;
  const length =
    item.media_type === "movie"
      ? item.runtime_minutes
        ? `${item.runtime_minutes} min`
        : null
      : item.seasons
        ? `${item.seasons} ${item.seasons === 1 ? "season" : "seasons"}`
        : null;

  async function toggleBox() {
    if (busy) return;
    setBusy(true);
    try {
      if (saved) await removeFromWatchlist(item.media_type, item.tmdb_id);
      else await addToWatchlist(item.media_type, item.tmdb_id);
      setSaved(!saved);
    } catch {
      showToast(saved ? `Couldn't remove it from ${boxName}.` : `Couldn't add it to ${boxName}.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article aria-label={item.title} className="flex gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3 sm:gap-5 sm:p-4">
      <Link href={href} className="relative block aspect-[2/3] w-24 shrink-0 self-start overflow-hidden rounded-xl bg-white/5 ring-1 ring-white/10 sm:w-32">
        {poster && <Image src={poster} alt="" fill sizes="128px" className="object-cover" />}
      </Link>

      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div>
          <h3 className="font-[family-name:var(--font-display)] text-lg font-semibold leading-tight text-white sm:text-xl">
            <Link href={href} className="hover:text-accent">
              {item.title}
            </Link>
          </h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-white/50">
            <span>{[item.year, length, item.media_type === "movie" ? "Movie" : "TV"].filter(Boolean).join(" · ")}</span>
            <RatingsButton mediaType={item.media_type} tmdbId={item.tmdb_id} tmdbRating={item.rating} />
            {item.trailer_key && <TrailerButton youtubeKey={item.trailer_key} title={item.title} />}
          </div>
        </div>

        {item.genres.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {item.genres.map((g) => (
              <span key={g} className="rounded-full border border-white/15 px-2.5 py-0.5 text-xs text-white/60">
                {g}
              </span>
            ))}
          </div>
        )}

        {item.reason && (
          <p className="text-sm text-accent">
            <span aria-hidden>✨ </span>
            {item.reason}
          </p>
        )}

        <Overview text={item.overview} standardMax={260} className="text-sm leading-relaxed text-white/70" />

        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          <a href={watchHref} className="inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent/90">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M8 5v14l11-7z" />
            </svg>
            Watch now
          </a>
          <button
            type="button"
            onClick={toggleBox}
            disabled={busy}
            aria-pressed={saved}
            className={`inline-flex h-10 items-center rounded-xl px-4 text-sm font-medium transition-colors disabled:opacity-60 ${
              saved ? "bg-white/15 text-white" : "bg-white/10 text-white/80 hover:bg-white/15"
            }`}
          >
            {saved ? `✓ In ${boxName}` : `+ ${boxName}`}
          </button>
          <Link href={href} className="inline-flex h-10 items-center rounded-xl px-3 text-sm text-white/60 hover:text-white">
            Details
          </Link>
        </div>
      </div>
    </article>
  );
}
