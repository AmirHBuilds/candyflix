"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import FadeImage from "@/components/FadeImage";
import type { ResolverPhase } from "@/components/player/useResolver";
import type { StreamState } from "@/lib/resolve";

/**
 * What the person sees between pressing play and the first frame: the episode's still (or the movie's
 * backdrop) under a soft shadow, slowly drifting, with honest status text. Shown while the server looks
 * for a source and while the first piece of the video downloads.
 */
export default function PlayerLoading({
  phase,
  artwork,
  title,
  sourceName,
  stream,
  error,
  queuePosition,
  onRetry,
  backHref,
}: {
  phase: ResolverPhase;
  artwork: string | null;
  title: string;
  sourceName: string | null;
  stream: StreamState | null;
  error: string | null;
  queuePosition?: number | null;
  onRetry: () => void;
  backHref: string;
}) {
  // After a while, say it is normal.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 9000);
    return () => clearTimeout(t);
  }, []);

  const failed = phase === "failed";
  const pct = stream?.progress != null ? Math.round(stream.progress) : null;
  const line = failed
    ? "We couldn't get a video for this one"
    : phase === "starting"
      ? `Preparing ${stream?.quality ?? "the video"}${sourceName ? ` from ${sourceName}` : ""}…`
      : queuePosition && queuePosition > 0
        ? `Waiting in line (${queuePosition})…`
        : "Finding the best source…";

  return (
    <div
      className="relative aspect-video w-full overflow-hidden bg-black"
      role="status"
      aria-live="polite"
      data-testid="player-loading"
      data-phase={phase}
    >
      {artwork && (
        <div className="absolute inset-0 overflow-hidden">
          <FadeImage src={artwork} alt="" fill priority sizes="100vw" className="animate-ken-burns object-cover opacity-80" />
        </div>
      )}
      {/* The shadow: darker at the edges and the bottom, so the text always reads. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,rgb(0_0_0/0.75)_100%)]" />
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-black/50" />

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
        {!failed && <div className="h-12 w-12 animate-spin rounded-full border-2 border-white/20 border-t-accent" />}
        <p className="font-[family-name:var(--font-display)] text-lg font-semibold text-white drop-shadow sm:text-2xl">{title}</p>
        <p className="animate-drift-in text-sm text-white/80 sm:text-base" key={line}>
          {line}
          {phase === "starting" && pct !== null && <span className="ml-2 tabular-nums text-white/60">{pct}%</span>}
        </p>
        {failed && error && <p className="max-w-md text-sm text-white/60">{error}</p>}
        {!failed && slow && <p className="text-xs text-white/50">This can take a little while the first time.</p>}
        {failed && (
          <div className="flex items-center gap-3">
            <button onClick={onRetry} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:bg-accent/90">
              Try again
            </button>
            <Link href={backHref} className="rounded-lg bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/20">
              Back to details
            </Link>
          </div>
        )}
      </div>

      {!failed && (
        <div className="absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-white/10">
          {phase === "starting" && pct !== null ? (
            <div className="h-full bg-accent transition-[width] duration-700" style={{ width: `${Math.max(pct, 3)}%` }} />
          ) : (
            <div className="animate-slide-bar h-full w-1/4 bg-accent" />
          )}
        </div>
      )}
    </div>
  );
}
