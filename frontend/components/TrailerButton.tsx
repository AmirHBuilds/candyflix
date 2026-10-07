"use client";

import { useState } from "react";
import Dialog from "@/components/admin/Dialog";

// A trailer, played from YouTube's privacy-friendly embed. The button is only drawn when TMDB has one.
export default function TrailerButton({ youtubeKey, title }: { youtubeKey: string; title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="inline-flex h-8 items-center gap-2 rounded-full bg-accent/15 pl-2 pr-3.5 text-sm font-medium text-white ring-1 ring-accent/50 transition-colors hover:bg-accent/25 focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span className="grid h-5 w-5 place-items-center rounded-full bg-accent text-on-accent">
          <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden className="ml-px">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
        Watch trailer
      </button>
      {open && (
        <Dialog title={`${title} · Trailer`} onClose={() => setOpen(false)} wide>
          <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
            <iframe
              title={`${title} trailer`}
              src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeKey)}?autoplay=1&rel=0&modestbranding=1`}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              className="h-full w-full border-0"
            />
          </div>
          <div className="mt-4 flex justify-end">
            <button type="button" onClick={() => setOpen(false)} className="h-10 rounded-xl bg-white/10 px-4 text-sm font-medium text-white/80 hover:bg-white/15">
              Close
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
