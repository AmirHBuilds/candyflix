"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { getSeason, stillUrl, type SeasonSummary, type Episode } from "@/lib/media";

export default function SeasonBrowser({
  tvId,
  seasons,
  initialSeason,
  currentEpisode,
}: {
  tvId: number;
  seasons: SeasonSummary[];
  // Defaults to the first season when omitted (show detail page usage).
  // The watch page passes the season currently playing instead, so
  // opening the picker doesn't dump you back at Season 1.
  initialSeason?: number;
  // Highlights this episode number when its season is selected — only
  // meaningful together with initialSeason, since "current episode"
  // only makes sense in the watch-page context.
  currentEpisode?: number;
}) {
  const [selected, setSelected] = useState<number | null>(initialSeason ?? seasons[0]?.season_number ?? null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (selected === null) return;
    setLoading(true);
    setError(null);
    getSeason(tvId, selected)
      .then((season) => setEpisodes(season.episodes))
      .catch(() => setError("Couldn't load episodes for this season."))
      .finally(() => setLoading(false));
  }, [tvId, selected]);

  if (seasons.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {seasons.map((season) => (
          <button
            key={season.season_number}
            onClick={() => setSelected(season.season_number)}
            className={
              selected === season.season_number
                ? "rounded-full bg-[#FF5FA2] px-4 py-1.5 text-sm font-medium text-[#0B0B12]"
                : "rounded-full border border-white/15 px-4 py-1.5 text-sm text-white/60 hover:text-white/90"
            }
          >
            {season.name}
          </button>
        ))}
      </div>

      {loading && <p className="text-white/40">Loading episodes…</p>}
      {error && <p className="text-[#FF5FA2]">{error}</p>}

      {!loading && !error && (
        <ul className="flex flex-col divide-y divide-white/10">
          {episodes.map((episode) => {
            const still = stillUrl(episode.still_path);
            const isCurrent = selected === initialSeason && episode.episode_number === currentEpisode;
            return (
              <li key={episode.episode_number}>
                <a
                  href={`/watch/tv/${tvId}/${selected}/${episode.episode_number}`}
                  className={`group flex gap-4 py-4 ${isCurrent ? "-mx-3 rounded-lg bg-white/5 px-3" : ""}`}
                >
                  <div className="relative h-[68px] w-[120px] shrink-0 overflow-hidden rounded-lg bg-white/5">
                    {still && (
                      <Image
                        src={still}
                        alt={episode.name}
                        fill
                        sizes="120px"
                        className="object-cover"
                      />
                    )}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <p className={isCurrent ? "font-medium text-[#FF5FA2]" : "text-white/90 group-hover:text-white"}>
                      {episode.episode_number}. {episode.name}
                      {isCurrent && <span className="ml-2 text-xs font-normal text-white/50">Now playing</span>}
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm text-white/50">{episode.overview}</p>
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
