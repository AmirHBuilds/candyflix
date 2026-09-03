"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { getSeason, stillUrl, type SeasonSummary, type Episode } from "@/lib/media";

export default function SeasonBrowser({
  tvId,
  seasons,
}: {
  tvId: number;
  seasons: SeasonSummary[];
}) {
  const [selected, setSelected] = useState<number | null>(seasons[0]?.season_number ?? null);
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
            return (
              <li key={episode.episode_number} className="flex gap-4 py-4">
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
                </div>
                <div className="min-w-0">
                  <p className="text-white/90">
                    {episode.episode_number}. {episode.name}
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm text-white/50">{episode.overview}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
