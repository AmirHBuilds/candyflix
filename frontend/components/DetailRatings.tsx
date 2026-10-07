"use client";

import { useEffect, useState } from "react";
import RatingIcon from "@/components/RatingIcon";
import { useSettings } from "@/components/SettingsProvider";
import { formatVotes, getRatings, RATING_SOURCES, type ExternalRating, type RatingSourceId } from "@/lib/rating-sources";

type Chip = { id: RatingSourceId; label: string; display: string; suffix: string; votes: number | null; url: string | null };

// The scores on a detail page: TMDB's right away, IMDb / Rotten Tomatoes / Metacritic as soon as
// the server has them. Which ones show is each person's choice (Settings → Appearance).
export default function DetailRatings({
  mediaType,
  tmdbId,
  tmdbRating,
}: {
  mediaType: "movie" | "tv";
  tmdbId: number;
  tmdbRating: number | null;
}) {
  const enabled = useSettings().settings.appearance.rating_sources;
  const [external, setExternal] = useState<ExternalRating[]>([]);

  const wantsExternal = enabled.imdb || enabled.rotten_tomatoes || enabled.metacritic;
  useEffect(() => {
    if (!wantsExternal) return;
    let cancelled = false;
    getRatings(mediaType, tmdbId)
      .then((r) => !cancelled && setExternal(r.ratings))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [mediaType, tmdbId, wantsExternal]);

  const chips: Chip[] = [];
  for (const s of RATING_SOURCES) {
    if (!enabled[s.id]) continue;
    if (s.id === "tmdb") {
      if (tmdbRating) chips.push({ id: "tmdb", label: s.label, display: tmdbRating.toFixed(1), suffix: "/10", votes: null, url: `https://www.themoviedb.org/${mediaType}/${tmdbId}` });
      continue;
    }
    const r = external.find((x) => x.source === s.id);
    if (r) chips.push({ id: s.id, label: r.label, display: r.display, suffix: r.suffix, votes: r.votes, url: r.url });
  }
  if (chips.length === 0) return null;

  return (
    <ul aria-label="Ratings" className="flex flex-wrap gap-2">
      {chips.map((c) => {
        const body = (
          <>
            <RatingIcon source={c.id} size={22} />
            <span className="leading-tight">
              <span className="block text-sm font-semibold text-white">
                {c.display}
                {c.suffix && <span className="text-xs font-normal text-white/40">{c.suffix}</span>}
              </span>
              <span className="block text-[11px] text-white/45">
                {c.label}
                {c.votes ? ` · ${formatVotes(c.votes)}` : ""}
              </span>
            </span>
          </>
        );
        const cls = "flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2";
        return (
          <li key={c.id} data-rating={c.id}>
            {c.url ? (
              <a href={c.url} target="_blank" rel="noopener noreferrer" aria-label={`${c.label} ${c.display}${c.suffix}`} className={`${cls} transition-colors hover:bg-white/[0.1]`}>
                {body}
              </a>
            ) : (
              <div aria-label={`${c.label} ${c.display}${c.suffix}`} className={cls}>
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
