"use client";

import { useEffect, useState } from "react";
import { addToWatchlist, getWatchlistStatus, removeFromWatchlist } from "@/lib/watchlist";
import type { MediaType } from "@/lib/media";

export default function DetailActions({
  watchHref,
  tmdbId,
  mediaType,
}: {
  watchHref?: string;
  tmdbId: number;
  mediaType: MediaType;
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

  return (
    <div className="flex flex-wrap gap-3">
      {watchHref ? (
        <a
          href={watchHref}
          className="rounded-xl bg-[#FF5FA2] px-6 py-2.5 font-medium text-[#0b0b12] hover:bg-[#FF5FA2]/90"
        >
          Watch Now
        </a>
      ) : (
        <button
          disabled
          title="Pick an episode below to watch"
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
