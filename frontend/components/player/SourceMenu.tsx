"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import PlayerTooltip from "@/components/player/PlayerTooltip";
import { SourceIcon } from "@/components/player/icons";
import type { SourceState, StreamState } from "@/lib/resolve";

export type SourcePicker = {
  sources: SourceState[];
  playingId: string | null;
  /** Still looking for more sources. */
  searching: boolean;
  /** More sources exist that haven't been asked: step 0 = "Load more sources", step 1 = "Load all sources". */
  more?: { step: 0 | 1; loading: boolean; onClick: () => void } | null;
  /** `atSeconds` is where the video is right now, so a switch carries on from the same spot. */
  onSelect: (streamId: string, atSeconds: number, totalSeconds: number) => void;
};

function Row({ stream, playing, onClick }: { stream: StreamState; playing: boolean; onClick: () => void }) {
  const downloading = stream.state === "downloading";
  const pct = Math.round(stream.progress ?? 0);
  const ready = stream.state === "ready";
  const failed = stream.state === "failed";
  const canPlay = !!stream.play_url;
  const hint = playing ? (downloading ? `Playing · ${pct}%` : "Playing") : ready ? "Ready" : failed ? "Try again" : downloading ? `${pct}%` : "Download";

  return (
    <button
      type="button"
      onClick={onClick}
      data-state={stream.state}
      data-playing={playing || undefined}
      aria-current={playing || undefined}
      aria-label={`${stream.quality}, ${playing ? "playing" : ready ? "ready, click to play" : downloading ? `downloading ${pct} percent${canPlay ? ", click to play" : ""}` : failed ? "failed, click to try again" : "not downloaded, click to download"}`}
      className={`relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-lg px-3 py-2 text-left text-sm transition-colors ${
        playing ? "bg-accent/25 text-white ring-1 ring-accent/60" : "bg-white/5 text-white/90 hover:bg-white/10"
      }`}
    >
      {downloading && (
        <span
          aria-hidden
          role="presentation"
          data-testid="source-fill"
          className="absolute inset-y-0 left-0 bg-accent/35 transition-[width] duration-700 ease-out"
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      )}
      <span className="relative flex items-center gap-2 font-medium">
        {stream.quality}
        {playing && <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />}
      </span>
      <span className={`relative text-xs tabular-nums ${failed ? "text-red-300" : downloading ? "text-white" : "text-white/55"}`}>
        {ready && !playing ? (
          <span className="inline-flex items-center gap-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
            Ready
          </span>
        ) : (
          hint
        )}
      </span>
    </button>
  );
}

/**
 * The player's source button and its menu: every source that found a video, each with its qualities.
 * A quality that isn't downloaded starts downloading on click (its row fills up with the progress and the
 * percentage is on the right); once it can play, clicking it plays it from the same spot.
 */
export default function SourceMenu({ picker, getTime, fullscreenHost }: { picker: SourcePicker; getTime: () => number; fullscreenHost?: HTMLElement | null }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ top: number; bottom: number; right: number; up: boolean; max: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    function recompute() {
      const rect = triggerRef.current!.getBoundingClientRect();
      const above = rect.top;
      const below = window.innerHeight - rect.bottom;
      const up = above >= 260 || above >= below;
      setAnchor({ top: rect.top, bottom: rect.bottom, right: window.innerWidth - rect.right, up, max: Math.max(140, (up ? above : below) - 16) });
    }
    recompute();
    window.addEventListener("resize", recompute);
    window.addEventListener("scroll", recompute, { capture: true, passive: true });
    return () => {
      window.removeEventListener("resize", recompute);
      window.removeEventListener("scroll", recompute, { capture: true });
    };
  }, [open]);

  // Which source's qualities are listed: the one the person picked, else the one playing, else the first.
  const [picked, setPicked] = useState<string | null>(null);
  const shown =
    picker.sources.find((x) => x.name === picked && x.streams.length > 0) ??
    picker.sources.find((x) => x.streams.some((y) => y.stream_id === picker.playingId)) ??
    picker.sources.find((x) => x.streams.length > 0) ??
    picker.sources[0] ??
    null;
  const total = picker.sources.reduce((n, s) => n + s.streams.length, 0);
  const portalTarget = fullscreenHost ?? (typeof document !== "undefined" ? document.body : null);

  return (
    <div className="relative" ref={triggerRef}>
      <PlayerTooltip label="Sources & quality" align="end" disabled={open}>
        <button
          aria-label="Sources and quality"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex h-8 w-8 pointer-coarse:h-10 pointer-coarse:w-10 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/20 hover:text-white"
        >
          <SourceIcon />
        </button>
      </PlayerTooltip>

      {open &&
        anchor &&
        portalTarget &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Sources"
            style={{
              position: "fixed",
              right: anchor.right,
              ...(anchor.up ? { bottom: window.innerHeight - anchor.top + 8 } : { top: anchor.bottom + 8 }),
              maxHeight: anchor.max,
            }}
            className="z-50 w-[22rem] max-w-[calc(100vw-1rem)] overflow-y-auto overflow-x-hidden rounded-xl border border-white/10 bg-canvas/95 p-2 shadow-2xl backdrop-blur"
          >
            <div className="flex gap-2">
              <div className="w-28 shrink-0 border-r border-white/10 pr-2" role="tablist" aria-label="Sources">
                <p className="px-2 pb-1.5 pt-1 text-xs font-medium uppercase tracking-wide text-white/45">Sources</p>
                {picker.sources.map((src) => {
                  const active = src.name === shown?.name;
                  const hasPlaying = src.streams.some((x) => x.stream_id === picker.playingId);
                  const empty = src.streams.length === 0 && (src.status === "ok" || src.status === "done" || src.status === "error" || src.status === "expired" || src.status === "failed");
                  return (
                    <button
                      key={src.name}
                      role="tab"
                      aria-selected={active}
                      disabled={empty}
                      title={empty ? "No video from this source" : undefined}
                      onClick={() => setPicked(src.name)}
                      className={`mb-1 flex w-full items-center justify-between gap-1 rounded-lg px-2 py-2 text-left text-sm transition-colors ${
                        empty
                          ? "cursor-not-allowed text-white/30 line-through decoration-white/20"
                          : active
                            ? "bg-white/15 font-semibold text-white"
                            : "text-white/70 hover:bg-white/10"
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-1">
                        <span className="truncate">{src.name}</span>
                        {src.starred && (
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="shrink-0 text-accent" aria-label="Reliable source">
                            <path d="M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.9 6.6 19.8l1.1-6.1L3.2 9.4l6.1-.8z" />
                          </svg>
                        )}
                      </span>
                      {hasPlaying && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-label="Playing from this source" />}
                    </button>
                  );
                })}
                {picker.sources.length === 0 && <p className="px-2 py-1 text-xs text-white/45">None yet</p>}
                {picker.more && (
                  <button
                    type="button"
                    onClick={picker.more.onClick}
                    disabled={picker.more.loading || picker.searching}
                    className="mt-1 flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-accent transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {picker.more.loading ? (
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/20 border-t-accent" aria-hidden />
                    ) : (
                      <span aria-hidden>+</span>
                    )}
                    {picker.more.step === 0 ? "Load more" : "Load all"}
                  </button>
                )}
              </div>
              <div className="min-w-0 flex-1" role="tabpanel">
                <p className="px-1 pb-1.5 pt-1 text-xs font-medium uppercase tracking-wide text-white/45">Quality</p>
                {shown && shown.streams.length === 0 ? (
                  <p className="px-1 pb-1 text-xs text-white/45">{shown.status === "ok" || shown.status === "done" ? "No video here" : "Nothing found"}</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {shown?.streams.map((s) => (
                      <Row
                        key={s.stream_id}
                        stream={s}
                        playing={s.stream_id === picker.playingId}
                        onClick={() => {
                          picker.onSelect(s.stream_id, getTime(), 0);
                          // Starting a download keeps the menu open so its progress can be watched.
                          if (s.play_url && s.stream_id !== picker.playingId) setOpen(false);
                        }}
                      />
                    ))}
                  </div>
                )}
                {total === 0 && <p className="px-1 py-2 text-sm text-white/60">No sources yet…</p>}
              </div>
            </div>
            {picker.searching && (
              <p className="flex items-center gap-2 px-2 pt-2 text-xs text-white/50">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/20 border-t-accent" aria-hidden />
                Still looking for more sources…
              </p>
            )}
          </div>,
          portalTarget
        )}
    </div>
  );
}
