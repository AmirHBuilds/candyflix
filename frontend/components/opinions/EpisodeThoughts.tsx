"use client";

import { useState } from "react";
import OpinionsSection from "@/components/opinions/OpinionsSection";

/** A small "Thoughts" button under an episode; opens that episode's opinions and hearts in place. */
export default function EpisodeThoughts({ tvId, season, episode }: { tvId: number; season: number; episode: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="pb-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="rounded-full px-2.5 py-1 text-xs text-white/50 transition-colors hover:bg-white/5 hover:text-white/80"
      >
        {open ? "Hide thoughts" : "💬 Thoughts"}
      </button>
      {open && (
        <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <OpinionsSection mediaType="tv" tmdbId={tvId} seasonNumber={season} episodeNumber={episode} heading={`Episode ${episode}`} />
        </div>
      )}
    </div>
  );
}
