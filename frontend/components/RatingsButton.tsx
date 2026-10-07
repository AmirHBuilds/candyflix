"use client";

import { useRef, useState } from "react";
import Dialog from "@/components/admin/Dialog";
import RatingIcon from "@/components/RatingIcon";
import { formatVotes, getRatings, RATING_SOURCES, type ExternalRating, type RatingSourceId } from "@/lib/rating-sources";

type Row = { id: RatingSourceId; label: string; note: string; display: string; suffix: string; votes: number | null; url: string | null };
type Load = { state: "idle" | "loading" | "done" | "failed"; external: ExternalRating[]; configured: boolean };

// "★ 7.8" next to the year, as a button. The other sites' scores cost one OMDb lookup (the free plan
// allows 1000 a day), so they are fetched only when someone opens this, and kept for the next open.
export default function RatingsButton({
  mediaType,
  tmdbId,
  tmdbRating,
}: {
  mediaType: "movie" | "tv";
  tmdbId: number;
  tmdbRating: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [load, setLoad] = useState<Load>({ state: "idle", external: [], configured: true });
  const started = useRef(false);

  function openWindow() {
    setOpen(true);
    if (started.current) return;
    started.current = true;
    setLoad((l) => ({ ...l, state: "loading" }));
    getRatings(mediaType, tmdbId)
      .then((r) => setLoad({ state: "done", external: r.ratings, configured: r.configured }))
      .catch(() => {
        started.current = false; // let the next open try again
        setLoad({ state: "failed", external: [], configured: true });
      });
  }

  const rows: Row[] = [];
  for (const s of RATING_SOURCES) {
    if (s.id === "tmdb") {
      if (tmdbRating) rows.push({ id: "tmdb", label: s.label, note: s.description, display: tmdbRating.toFixed(1), suffix: "/10", votes: null, url: `https://www.themoviedb.org/${mediaType}/${tmdbId}` });
      continue;
    }
    const r = load.external.find((x) => x.source === s.id);
    if (r) rows.push({ id: s.id, label: r.label, note: s.description, display: r.display, suffix: r.suffix, votes: r.votes, url: r.url });
  }

  return (
    <>
      <button
        type="button"
        onClick={openWindow}
        aria-haspopup="dialog"
        aria-label="Show all ratings"
        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] pl-2.5 pr-3 text-sm text-white/80 transition-colors hover:bg-white/[0.12] hover:text-white focus-visible:outline-2 focus-visible:outline-accent"
      >
        {tmdbRating ? (
          <>
            <span className="text-amber-300">★</span>
            <span className="font-semibold text-white">{tmdbRating.toFixed(1)}</span>
            <span className="text-white/25">·</span>
          </>
        ) : null}
        <span>Ratings</span>
      </button>

      {open && (
        <Dialog title="Ratings" onClose={() => setOpen(false)}>
          <ul className="flex flex-col gap-2">
            {rows.map((r) => {
              const body = (
                <>
                  <RatingIcon source={r.id} size={30} />
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block text-sm font-medium text-white">{r.label}</span>
                    <span className="block text-xs text-white/45">
                      {r.note}
                      {r.votes ? ` · ${formatVotes(r.votes)} votes` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-lg font-semibold text-white">
                    {r.display}
                    {r.suffix && <span className="text-xs font-normal text-white/40">{r.suffix}</span>}
                  </span>
                </>
              );
              const cls = "flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-3";
              return (
                <li key={r.id} data-rating={r.id}>
                  {r.url ? (
                    <a href={r.url} target="_blank" rel="noopener noreferrer" aria-label={`${r.label} ${r.display}${r.suffix}`} className={`${cls} transition-colors hover:bg-white/[0.09]`}>
                      {body}
                    </a>
                  ) : (
                    <div aria-label={`${r.label} ${r.display}${r.suffix}`} className={cls}>
                      {body}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {load.state === "loading" && (
            <p role="status" className="mt-3 text-sm text-white/50">
              Getting the other ratings…
            </p>
          )}
          {load.state === "failed" && <p className="mt-3 text-sm text-white/50">Couldn&apos;t load the other ratings. Close this and try again.</p>}
          {load.state === "done" && !load.configured && (
            <p className="mt-3 text-sm text-white/50">IMDb, Rotten Tomatoes and Metacritic aren&apos;t set up on this server.</p>
          )}
          {load.state === "done" && load.configured && load.external.length === 0 && (
            <p className="mt-3 text-sm text-white/50">No IMDb, Rotten Tomatoes or Metacritic scores for this title yet.</p>
          )}

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
