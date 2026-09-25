"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { getSeason, stillUrl, type SeasonSummary, type Episode } from "@/lib/media";
import { getSeasonWatchProgress } from "@/lib/playback";

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

  // Episode number -> fraction watched (0-1, capped), for every episode
  // of the selected season with any saved progress. Keyed by episode
  // number alone since it's always scoped to `selected`'s season.
  const [progressByEpisode, setProgressByEpisode] = useState<Record<number, number>>({});

  useEffect(() => {
    if (selected === null) return;
    setLoading(true);
    setError(null);
    getSeason(tvId, selected)
      .then((season) => setEpisodes(season.episodes))
      .catch(() => setError("Couldn't load episodes for this season."))
      .finally(() => setLoading(false));
  }, [tvId, selected]);

  // Deliberately a separate effect (and separate failure mode) from the
  // episode list fetch above: losing the "you've watched this one"
  // highlighting isn't worth erroring or blocking the whole season view
  // over, so a failure here just leaves every episode unhighlighted
  // rather than showing an error banner.
  useEffect(() => {
    if (selected === null) return;
    let cancelled = false;
    getSeasonWatchProgress(tvId, selected)
      .then((rows) => {
        if (cancelled) return;
        const byEpisode: Record<number, number> = {};
        for (const row of rows) {
          if (row.episode_number == null || row.duration_seconds <= 0) continue;
          byEpisode[row.episode_number] = Math.min(1, row.position_seconds / row.duration_seconds);
        }
        setProgressByEpisode(byEpisode);
      })
      .catch(() => {
        if (!cancelled) setProgressByEpisode({});
      });
    return () => {
      cancelled = true;
    };
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
            const watchedFraction = progressByEpisode[episode.episode_number];
            // isCurrent ("Now playing", watch-page only) already
            // communicates state on its own — suppress the separate
            // watched styling there instead of stacking both.
            const hasProgress = watchedFraction != null && !isCurrent;
            return (
              <li key={episode.episode_number}>
                <a
                  href={`/watch/tv/${tvId}/${selected}/${episode.episode_number}`}
                  className={`group flex gap-4 py-4 ${isCurrent ? "-mx-3 rounded-lg bg-white/5 px-3" : ""}`}
                >
                  <div
                    className={`relative h-[68px] w-[120px] shrink-0 overflow-hidden rounded-lg bg-white/5 ${
                      hasProgress ? "ring-1 ring-[#FF5FA2]/50" : ""
                    }`}
                  >
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
                    {hasProgress && (
                      <div className="absolute inset-x-0 bottom-0 h-1 bg-black/50">
                        <div
                          className="h-full bg-[#FF5FA2]"
                          style={{ width: `${Math.round(watchedFraction * 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className={isCurrent ? "font-medium text-[#FF5FA2]" : "text-white/90 group-hover:text-white"}>
                      {episode.episode_number}. {episode.name}
                      {isCurrent && <span className="ml-2 text-xs font-normal text-white/50">Now playing</span>}
                      {hasProgress && (
                        <span className="ml-2 text-xs font-normal text-[#FF5FA2]/80">
                          {watchedFraction >= 0.95 ? "Watched" : "In progress"}
                        </span>
                      )}
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
