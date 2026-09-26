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
          className="flex items-center gap-2 rounded-xl bg-[#FF5FA2] px-6 py-2.5 font-medium text-[#0b0b12] hover:bg-[#FF5FA2]/90"
        >
          Watch Now
          {/* Same box as the button, not a separate element next to it.
              A solid dark pill (rather than a translucent/opacity
              treatment) so the label stays readable against the pink
              button instead of blending into it. */}
          {resumeLabel && (
            <span className="rounded-md bg-[#0b0b12]/80 px-2 py-0.5 text-xs font-semibold text-white">
              {resumeLabel}
            </span>
          )}
        </a>
      ) : (
        <button
          disabled
          className="cursor-not-allowed rounded-xl bg-[#FF5FA2]/30 px-6 py-2.5 font-medium text-white/50"
        >
          Watch Now
        </button>
      )}
      <button
        onClick={toggleCandyBox}
        disabled={inCandyBox === null || pending}
        aria-pressed={inCandyBox === true}
        className={
          inCandyBox
            ? "rounded-xl border border-[#FF5FA2] bg-[#FF5FA2]/10 px-6 py-2.5 font-medium text-[#FF5FA2] transition-colors hover:bg-[#FF5FA2]/20 disabled:cursor-not-allowed disabled:opacity-70"
            : "rounded-xl border border-white/15 px-6 py-2.5 font-medium text-white/80 transition-colors hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        }
      >
        {inCandyBox ? "✓ In Candy Box" : "Add to Candy Box"}
      </button>
    </div>
  );
}
