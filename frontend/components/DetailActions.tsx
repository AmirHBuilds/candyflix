"use client";

import { useEffect, useState } from "react";
import { addToWatchlist, getWatchlistStatus, removeFromWatchlist } from "@/lib/watchlist";
import type { WatchProgress } from "@/lib/playback";
import type { MediaType } from "@/lib/media";

export default function DetailActions({
  watchHref,
  tmdbId,
  mediaType,
  tvProgress,
}: {
  // Movies always arrive with this already set (see app/(main)/movie/[id]/page.tsx).
  watchHref?: string;
  tmdbId: number;
  mediaType: MediaType;
  // TV only: the show's latest saved progress, fetched once server-side
  // by the TV detail page (see getLatestTVWatchProgressServer) and
  // passed down here — undefined/omitted for a movie, null for "never
  // started this show". Resolving it server-side means no loading flash
  // and no separate client fetch duplicating what SeasonBrowser also
  // needs from the same page.
  tvProgress?: WatchProgress | null;
}) {
  // null = not resolved yet — the button stays disabled rather than
  // guessing "not in the list" while the real status is still loading,
  // which would otherwise let a click race the actual answer.
  const [inCandyBox, setInCandyBox] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getWatchlistStatus(mediaType, tmdbId)
      .then((status) => {
        if (!cancelled) setInCandyBox(status);
      })
      .catch(() => {
        if (!cancelled) setInCandyBox(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mediaType, tmdbId]);

  async function toggleCandyBox() {
    if (inCandyBox === null || pending) return;
    setPending(true);
    try {
      if (inCandyBox) {
        await removeFromWatchlist(mediaType, tmdbId);
        setInCandyBox(false);
      } else {
        await addToWatchlist(mediaType, tmdbId);
        setInCandyBox(true);
      }
    } catch {
      // Leave the button at its last known-good state — a failed
      // toggle just means nothing changed, so no correction is needed.
    } finally {
      setPending(false);
    }
  }

  // A movie always has watchHref already. For TV, resume at the exact
  // remembered episode if there's any history, otherwise start at S1E1
  // — "Watch Now" is never a dead end for TV anymore.
  const resumeLabel =
    mediaType === "tv" && tvProgress?.season_number != null && tvProgress?.episode_number != null
      ? `S${tvProgress.season_number}:E${tvProgress.episode_number}`
      : null;
  const tvWatchHref =
    mediaType === "tv"
      ? resumeLabel
        ? `/watch/tv/${tmdbId}/${tvProgress!.season_number}/${tvProgress!.episode_number}`
        : `/watch/tv/${tmdbId}/1/1`
      : null;
  const effectiveHref = watchHref ?? tvWatchHref;

  return (
    <div className="flex flex-wrap items-center gap-3">
      {effectiveHref ? (
        <a
          href={effectiveHref}
          className="flex items-center gap-3 rounded-xl bg-[#FF5FA2] py-3 pl-5 pr-6 text-base font-semibold text-[#0b0b12] hover:bg-[#FF5FA2]/90"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M8 5v14l11-7z" />
          </svg>
          Watch Now
          {/* A solid dark pill, sized to match the button around it,
              rather than a small afterthought — this is what "Watch
              Now" will actually resume, so it earns equal visual
              weight, not a tiny label crammed in beside it. */}
          {resumeLabel && (
            <span className="rounded-full bg-[#0b0b12] px-3 py-1 text-sm font-semibold text-white">
              {resumeLabel}
            </span>
          )}
        </a>
      ) : (
        <button
          disabled
          className="flex items-center gap-3 rounded-xl bg-[#FF5FA2]/30 py-3 pl-5 pr-6 text-base font-semibold text-white/50"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M8 5v14l11-7z" />
          </svg>
          Watch Now
        </button>
      )}
      <button
        onClick={toggleCandyBox}
        disabled={inCandyBox === null || pending}
        aria-pressed={inCandyBox === true}
        className={
          inCandyBox
            ? "rounded-xl border border-[#FF5FA2] bg-[#FF5FA2]/10 px-6 py-3 text-base font-semibold text-[#FF5FA2] transition-colors hover:bg-[#FF5FA2]/20 disabled:cursor-not-allowed disabled:opacity-70"
            : "rounded-xl border border-white/15 px-6 py-3 text-base font-semibold text-white/80 transition-colors hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        }
      >
        {inCandyBox ? "✓ In Candy Box" : "Add to Candy Box"}
      </button>
    </div>
  );
}
