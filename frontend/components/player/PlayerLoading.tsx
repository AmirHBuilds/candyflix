"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import FadeImage from "@/components/FadeImage";
import type { ResolverPhase } from "@/components/player/useResolver";
import { hasStreams, type ResolveState, type StreamState } from "@/lib/resolve";

/**
 * What the person sees between pressing play and the first frame: the episode's still (or the movie's
 * backdrop) under a soft shadow, slowly drifting, with honest status text. Shown while the server looks
 * for a source and while the first piece of the video downloads. It says what the server is doing right now (how many
 * sources have answered, where the search stands in line, what was found, how far the first part has come) and lays the
 * four steps out so a long wait never looks stuck.
 */
export default function PlayerLoading({
  phase,
  artwork,
  title,
  sourceName,
  stream,
  error,
  queuePosition,
  state = null,
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
  /** What the server has reported so far (null until its first answer). */
  state?: ResolveState | null;
  onRetry: () => void;
  backHref: string;
}) {
  // How long this has been going, so a slow search can say so (and the person can see time is passing).
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(t);
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


  // What each part of the wait is, and where it stands.
  const found = hasStreams(state);
  const withVideo = (state?.sources ?? []).filter((x) => x.streams.length > 0);
  const best = withVideo[0]?.streams[0];
  const total = state?.sources_total ?? 0;
  const answered = state?.sources_done ?? 0;
  const inLine = queuePosition && queuePosition > 0 ? queuePosition : 0;
  const stage = !state ? 0 : !found ? 1 : phase === "starting" && pct !== null && pct > 0 ? 3 : 2; // 0 connect, 1 search, 2 found/starting, 3 downloading
  const detail = failed
    ? null
    : !state
      ? "Connecting to the video service"
      : !found
        ? inLine
          ? "Other searches are ahead of yours; it starts as soon as a spot is free"
          : total > 0
            ? `${answered} of ${total} ${total === 1 ? "source has" : "sources have"} answered`
            : "Asking the sources for this title"
        : phase === "starting"
          ? pct !== null && pct > 0
            ? "Downloading the first part, the video starts when there is enough"
            : "Found it. Starting the download"
          : "Found it";
  const steps: { label: string; note: string | null; at: number }[] = [
    { label: "Reach the video service", note: null, at: 0 },
    {
      label: "Ask the sources",
      note: !state ? null : found ? `${withVideo.map((x) => x.name).join(", ")} answered` : inLine ? `#${inLine} in line` : total > 0 ? `${answered} of ${total} answered` : null,
      at: 1,
    },
    { label: "Pick the best one", note: found ? `${best?.quality ?? "Video"}${withVideo[0] ? ` from ${withVideo[0].name}` : ""}` : null, at: 2 },
    { label: "Get the first part ready", note: stage === 3 && pct !== null ? `${pct}%` : null, at: 3 },
  ];
  const reassure = failed ? null : elapsed >= 25 ? "This one is taking longer than usual. Hang on, it is still working." : elapsed >= 10 ? "Some sources are slow to answer. Still trying." : elapsed >= 4 ? "This can take a little while the first time." : null;
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
          <FadeImage src={artwork} alt="" fill priority quality={90} sizes="100vw" className="animate-ken-burns object-cover opacity-80" />
        </div>
      )}
      {/* The shadow: darker at the edges and the bottom, so the text always reads. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,rgb(0_0_0/0.75)_100%)]" />
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-black/50" />

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
        {!failed && <div className="h-9 w-9 animate-spin rounded-full border-2 border-white/20 border-t-accent sm:hidden" />}
        <p className="font-[family-name:var(--font-display)] text-lg font-semibold text-white drop-shadow sm:text-2xl">{title}</p>
        <p className="animate-drift-in text-sm text-white/80 sm:text-base" key={line}>
          {line}
          {phase === "starting" && pct !== null && <span className="ml-2 tabular-nums text-white/60">{pct}%</span>}
        </p>
        {detail && (
          <p className="-mt-2 max-w-sm text-xs text-white/55 sm:text-sm" data-testid="loading-detail" key={detail}>
            {detail}
          </p>
        )}
        {!failed && (
          <>
            {/* Phones: four small segments (little room); bigger screens: the four steps written out. */}
            <div className="flex w-40 gap-1 sm:hidden" aria-hidden>
              {steps.map((st) => (
                <span key={st.at} className={`h-1 flex-1 rounded-full ${st.at < stage ? "bg-accent" : st.at === stage ? "animate-pulse bg-accent/70" : "bg-white/15"}`} />
              ))}
            </div>
            <ol className="hidden w-full max-w-xs flex-col gap-1.5 text-left sm:flex" data-testid="loading-steps">
              {steps.map((st) => {
                const done = st.at < stage;
                const active = st.at === stage;
                return (
                  <li key={st.at} data-step={done ? "done" : active ? "active" : "todo"} className="flex items-center gap-2.5 text-sm">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                      {done ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-accent" aria-hidden>
                          <path d="M5 12.5l4.5 4.5L19 7.5" />
                        </svg>
                      ) : active ? (
                        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/25 border-t-accent" aria-hidden />
                      ) : (
                        <span className="h-2 w-2 rounded-full bg-white/25" aria-hidden />
                      )}
                    </span>
                    <span className={done ? "text-white/55" : active ? "font-medium text-white" : "text-white/35"}>{st.label}</span>
                    {st.note && (done || active) && <span className="ml-auto truncate pl-3 text-xs tabular-nums text-white/55">{st.note}</span>}
                  </li>
                );
              })}
            </ol>
          </>
        )}
        {failed && error && <p className="max-w-md text-sm text-white/60">{error}</p>}
        {reassure && (
          <p className="animate-drift-in text-xs text-white/50" key={reassure}>
            {reassure}
            {elapsed >= 4 && <span className="ml-2 tabular-nums text-white/35">{elapsed}s</span>}
          </p>
        )}
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
