"use client";

import { useEffect, useState } from "react";
import { addToWatchlist, getWatchlistStatus, removeFromWatchlist } from "@/lib/watchlist";
import { getLatestTVWatchProgress } from "@/lib/playback";
import type { MediaType } from "@/lib/media";

export default function DetailActions({
  watchHref,
  tmdbId,
  mediaType,
}: {
  // Movies always arrive with this already set (see app/(main)/movie/[id]/page.tsx).
  // TV never passes one in — there's no single "the" episode for a show
  // — so it's resolved below instead: resume the last-watched episode
  // if there's any history, otherwise start at S1E1.
  watchHref?: string;
  tmdbId: number;
  mediaType: MediaType;
}) {
  // null = not resolved yet — the button stays disabled rather than
  // guessing "not in the list" while the real status is still loading,
  // which would otherwise let a click race the actual answer.
  const [inCandyBox, setInCandyBox] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);

  // Resolved on mount for TV only; stays null the whole time for a
  // movie, since movies always arrive with an explicit watchHref
  // already and never need this. null here means "still loading",
  // not "no progress" — see effectiveHref below.
  const [tvWatchHref, setTvWatchHref] = useState<string | null>(null);
  const [resumeLabel, setResumeLabel] = useState<string | null>(null);

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

  useEffect(() => {
    if (mediaType !== "tv") return;
    let cancelled = false;
    getLatestTVWatchProgress(tmdbId)
      .then((progress) => {
        if (cancelled) return;
        if (progress?.season_number != null && progress.episode_number != null) {
          setTvWatchHref(`/watch/tv/${tmdbId}/${progress.season_number}/${progress.episode_number}`);
          setResumeLabel(`S${progress.season_number}:E${progress.episode_number}`);
        } else {
          // Never started — Watch Now begins the show from the top.
          setTvWatchHref(`/watch/tv/${tmdbId}/1/1`);
        }
      })
      .catch(() => {
        // Couldn't check history — fail toward "start from S1E1" rather
        // than leaving the button disabled indefinitely; worst case a
        // returning viewer restarts instead of resuming, which is a far
        // smaller cost than a permanently dead button.
        if (!cancelled) setTvWatchHref(`/watch/tv/${tmdbId}/1/1`);
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

  // Movies already have watchHref from the start (instant, no flash).
  // TV resolves it moments after mount — a brief disabled state is the
  // cost of knowing whether to resume or start over, same tolerance the
  // Candy Box button already has for inCandyBox === null above.
  const effectiveHref = watchHref ?? tvWatchHref;

  return (
    <div className="flex flex-wrap items-center gap-3">
      {effectiveHref ? (
        <a
          href={effectiveHref}
          className="rounded-xl bg-[#FF5FA2] px-6 py-2.5 font-medium text-[#0b0b12] hover:bg-[#FF5FA2]/90"
        >
          Watch Now
        </a>
      ) : (
        <button
          disabled
          className="cursor-not-allowed rounded-xl bg-[#FF5FA2]/30 px-6 py-2.5 font-medium text-white/50"
        >
          Watch Now
        </button>
      )}
      {resumeLabel && <span className="text-sm text-white/50">{resumeLabel}</span>}
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
