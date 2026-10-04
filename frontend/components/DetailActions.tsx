"use client";

import { useEffect, useState } from "react";
import { addToWatchlist, getWatchlistStatus, removeFromWatchlist } from "@/lib/watchlist";
import { getLatestTVWatchProgress, type WatchProgress } from "@/lib/playback";
import { showToast } from "@/lib/toast";
import type { MediaType } from "@/lib/media";

// Sizing tiers, driven by the width of the space the buttons actually
// get (a container query, not the viewport) — the TV detail page's
// poster, the hero's padding and the phone layout all change that width
// differently, so the viewport alone can't tell us. Each tier only
// shrinks the buttons when the row would otherwise wrap:
//   big     16px text, 20px side padding  (the original look)
//   compact 15px, 16px padding
//   tight   14px, 12px padding
//   stack   below "tight": two equal full-width rows, still big — an
//           intentional layout instead of an accidental wrap.
// The two buttons always share one width (auto-cols-fr) and one height.
// Thresholds are the measured width of the equal-width pair plus a few
// px of safety, and depend on how wide the resume chip makes Watch Now
// ("S1:E8" vs "S10:E12"), so they come in three sets. Tailwind needs the
// full class strings literally, hence the repetition.
const GRID_BY_LABEL = {
  none: "grid gap-3 text-base [--pad:1.25rem] @[324px]:w-fit @[324px]:grid-flow-col @[324px]:auto-cols-fr @[324px]:text-sm @[324px]:[--pad:0.75rem] @[358px]:text-[15px] @[358px]:[--pad:1rem] @[392px]:text-base @[392px]:[--pad:1.25rem]",
  short:
    "grid gap-3 text-base [--pad:1.25rem] @[360px]:w-fit @[360px]:grid-flow-col @[360px]:auto-cols-fr @[360px]:text-sm @[360px]:[--pad:0.75rem] @[408px]:text-[15px] @[408px]:[--pad:1rem] @[452px]:text-base @[452px]:[--pad:1.25rem]",
  long: "grid gap-3 text-base [--pad:1.25rem] @[388px]:w-fit @[388px]:grid-flow-col @[388px]:auto-cols-fr @[388px]:text-sm @[388px]:[--pad:0.75rem] @[438px]:text-[15px] @[438px]:[--pad:1rem] @[484px]:text-base @[484px]:[--pad:1.25rem]",
} as const;

const BUTTON_BASE =
  "flex h-12 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-[var(--pad)] font-semibold";

export default function DetailActions({
  tmdbId,
  mediaType,
  tvProgress,
}: {
  tmdbId: number;
  mediaType: MediaType;
  // TV only: the show's latest saved progress. The TV detail page
  // resolves it server-side and passes it in (a value, or null for
  // "never started"), so there's no loading flash and no duplicate
  // fetch alongside SeasonBrowser. Left undefined (the home hero, which
  // has no such page around it) the component looks it up itself.
  tvProgress?: WatchProgress | null;
}) {
  const [fetchedProgress, setFetchedProgress] = useState<WatchProgress | null | undefined>(undefined);
  useEffect(() => {
    if (mediaType !== "tv" || tvProgress !== undefined) return;
    let cancelled = false;
    getLatestTVWatchProgress(tmdbId)
      .then((p) => {
        if (!cancelled) setFetchedProgress(p);
      })
      .catch(() => {
        // Can't resolve history — Watch Now just starts at S1:E1.
        if (!cancelled) setFetchedProgress(null);
      });
    return () => {
      cancelled = true;
    };
  }, [mediaType, tmdbId, tvProgress]);
  const progress = tvProgress !== undefined ? tvProgress : fetchedProgress;

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
      // The button stays at its last known-good state (nothing changed),
      // but say so — otherwise a tap that did nothing looks broken.
      showToast(
        inCandyBox
          ? "Couldn't remove it from your Candy Box. Please try again."
          : "Couldn't add it to your Candy Box. Please try again."
      );
    } finally {
      setPending(false);
    }
  }

  // Watch Now is never a dead end. A movie goes straight to its
  // player; TV resumes at the remembered episode if there's any
  // history, otherwise starts at S1E1.
  const resumeLabel =
    mediaType === "tv" && progress?.season_number != null && progress?.episode_number != null
      ? `S${progress.season_number}:E${progress.episode_number}`
      : null;
  const watchHref =
    mediaType === "movie"
      ? `/watch/movie/${tmdbId}`
      : resumeLabel
        ? `/watch/tv/${tmdbId}/${progress!.season_number}/${progress!.episode_number}`
        : `/watch/tv/${tmdbId}/1/1`;
  const labelSize = !resumeLabel ? "none" : resumeLabel.length <= 5 ? "short" : "long";

  return (
    // The outer block is the size-measuring container; the grid inside
    // is what actually resizes (a container can't restyle itself).
    <div className="@container w-full">
      <div className={GRID_BY_LABEL[labelSize]}>
        <a
          href={watchHref}
          className={`${BUTTON_BASE} bg-accent text-on-accent hover:bg-accent/90 ${
            resumeLabel ? "pr-[calc(var(--pad)_-_0.5rem)]" : ""
          }`}
        >
          <svg className="h-[1.1em] w-[1.1em] shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M8 5v14l11-7z" />
          </svg>
          Watch Now
          {/* A solid dark rounded-rectangle chip: dark-on-pink was once
              "lost in the box colour", so it stays a high-contrast
              chip. It sits one small gap from the text, and its size is
              relative to the font (em) so it can't make the button
              taller than the fixed h-12. */}
          {resumeLabel && (
            <span className="rounded-md bg-canvas px-2 py-1 text-[0.8em] font-semibold leading-none text-white">
              {resumeLabel}
            </span>
          )}
        </a>
        <button
          onClick={toggleCandyBox}
          disabled={inCandyBox === null || pending}
          aria-pressed={inCandyBox === true}
          className={`${BUTTON_BASE} border transition-colors disabled:cursor-not-allowed ${
            inCandyBox
              ? "border-accent bg-accent/10 text-accent hover:bg-accent/20 disabled:opacity-70"
              : "border-white/15 text-white/80 hover:border-white/30 hover:text-white disabled:opacity-50"
          }`}
        >
          {inCandyBox ? "✓ In Candy Box" : "Add to Candy Box"}
        </button>
      </div>
    </div>
  );
}
