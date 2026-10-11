"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import OpinionsSection from "@/components/opinions/OpinionsSection";
import { setCommentCount, useTitleLikes } from "@/lib/title-likes";
import type { Scope } from "@/lib/opinions";

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[1.15em] w-[1.15em]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
    </svg>
  );
}

/**
 * A "Discussion" button that opens the opinions in a side panel (a bottom sheet on phones), so nothing
 * takes room on the page until someone asks for it. Hidden when opinions are switched off.
 */
export default function DiscussionButton({
  scope,
  title,
  variant = "pill",
  className = "",
}: {
  scope: Scope;
  title: string;
  /** "action": icon + count, tall like Watch Now. "pill": icon + count, small. "plain": bring your own classes. */
  variant?: "action" | "pill" | "segment" | "plain";
  className?: string;
}) {
  const { enabled, comments } = useTitleLikes(scope);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", esc);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", esc);
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!enabled) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={comments > 0 ? `Discussion, ${comments} ${comments === 1 ? "comment" : "comments"}` : "Discussion"}
        className={
          (variant === "pill"
            ? "inline-flex h-9 items-center gap-1.5 rounded-full border border-white/15 px-3.5 text-sm font-medium text-white/80 transition-colors hover:border-white/30 hover:text-white "
            : variant === "segment"
              ? "flex h-full min-w-12 items-center justify-center gap-1.5 whitespace-nowrap px-3 font-semibold text-white/80 transition-colors hover:bg-white/5 hover:text-white "
              : variant === "action"
              ? "flex h-12 min-w-12 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-white/15 px-3 font-semibold text-white/80 transition-colors hover:border-white/30 hover:text-white "
              : "") + className
        }
      >
        <ChatIcon />
        {comments > 0 && <span className="tabular-nums">{comments}</span>}
      </button>
      {/* In <body>, not here: the button sits inside a container-query box, which would trap a fixed panel inside it (behind the header). */}
      {open && createPortal(
        <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label={`Discussion: ${title}`}>
          <button type="button" aria-label="Close discussion" tabIndex={-1} onClick={() => setOpen(false)} className="animate-fade-in absolute inset-0 cursor-default bg-black/60" />
          <div className="animate-sheet absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-3xl border border-white/10 bg-canvas shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[28rem] sm:rounded-l-3xl sm:rounded-tr-none">
            <header className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-white">Discussion</h2>
                <p className="truncate text-sm text-white/50">{title}</p>
              </div>
              <button type="button" autoFocus onClick={() => setOpen(false)} aria-label="Close" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <OpinionsSection
                mediaType={scope.media_type}
                tmdbId={scope.tmdb_id}
                seasonNumber={scope.season_number}
                episodeNumber={scope.episode_number}
                heading={null}
                onLoaded={(n) => setCommentCount(scope, n)}
              />
            </div>
          </div>
        </div>
        , document.body)}
    </>
  );
}
