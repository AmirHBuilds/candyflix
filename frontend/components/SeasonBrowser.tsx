"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { getSeason, stillUrl, type SeasonSummary, type Episode } from "@/lib/media";
import { getSeasonWatchProgress, navigateWithResumeHint, type WatchProgress } from "@/lib/playback";
import ErrorState from "@/components/ErrorState";
import { EpisodeListSkeleton } from "@/components/Skeleton";

// Mirrors NEAR_COMPLETE_FRACTION in the backend's watch_progress_service.py:
// an episode at/past this fraction of its duration counts as finished,
// not "in progress" — so it never competes for the one "In progress"
// slot below.
const NEAR_COMPLETE_FRACTION = 0.95;

export default function SeasonBrowser({
  tvId,
  seasons,
  initialSeason,
  currentEpisode,
  resumeEpisode,
  recentVisit,
}: {
  tvId: number;
  seasons: SeasonSummary[];
  // Defaults to the first season when omitted (show detail page usage).
  // The watch page passes the season currently playing instead, so
  // opening the picker doesn't dump you back at Season 1.
  initialSeason?: number;
  // Highlights this episode number when its season is selected — only
  // ever passed together with resumeEpisode, from the watch page (see
  // isPlayerContext below).
  currentEpisode?: number;
  // The show's high-water mark (see getLatestTVWatchProgressServer /
  // get_latest_progress_for_title): the furthest episode ever reached,
  // which is what "Watch Now" resumes — NOT simply whatever was most
  // recently touched. Passed on both the detail page (its only special
  // episode: pink name) and the watch page (a second, differently
  // colored highlight alongside "Now playing", since the two can differ
  // — e.g. playing S1:E1 again while S1:E5 remains the real resume
  // point).
  resumeEpisode?: WatchProgress | null;
  // The episode the person was just on before landing here (from the
  // ?fromSeason=&fromEpisode= hint — see navigateWithResumeHint), detail
  // page only. Treated as the most recent activity by definition, so
  // "In progress" doesn't have to wait for that episode's own save to
  // land (and for this page's fetch to see it) before showing up — the
  // same race the hint already closes for the resume point itself.
  recentVisit?: { seasonNumber: number; episodeNumber: number } | null;
}) {
  const [selected, setSelected] = useState<number | null>(initialSeason ?? seasons[0]?.season_number ?? null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only the watch page ever passes currentEpisode (something is
  // literally playing there); the detail page never does. This is the
  // one flag that decides both what "resumeEpisode" is styled as (pink
  // vs. a different color so it doesn't get confused with "Now
  // playing") and whether the separate "In progress" indicator applies
  // at all — see the request this was built for: on the player page,
  // only "Now playing" should show, nothing else.
  const isPlayerContext = currentEpisode !== undefined;

  // On the player page, resumeEpisode can be stale relative to what's
  // actually playing right now: it's whatever the server last knew
  // before this page loaded, and saving a new high-water mark for the
  // episode you just clicked into takes a moment (or, before that save
  // lands, simply hasn't happened yet). If resumeEpisode is BEHIND what
  // you just navigated to, showing it as "Last watched" is stale,
  // confusing information — you're already past it. Only show it when
  // it's genuinely still AHEAD of what's playing (e.g. resuming S1:E1
  // while your real progress is at S1:E5) — that's the one case where
  // it tells you something you don't already know. On the detail page
  // there's no "currently playing" to be stale relative to, so this is
  // always true there.
  const resumeIsAheadOfPlaying =
    !isPlayerContext ||
    (resumeEpisode?.season_number != null &&
      resumeEpisode.episode_number != null &&
      initialSeason != null &&
      currentEpisode != null &&
      (resumeEpisode.season_number > initialSeason ||
        (resumeEpisode.season_number === initialSeason && resumeEpisode.episode_number > currentEpisode)));

  // At most one *other* episode gets flagged, on purpose — every
  // episode with any saved progress lighting up made the list noisy and
  // duplicated what the resume-point highlighting above already says.
  // This is specifically "the one you dipped into more recently than
  // your high-water mark, but didn't finish" — e.g. you're resuming
  // S1:E5 but poked at S1:E1 without finishing it. null when there's no
  // such episode. Detail-page only — see isPlayerContext.
  const [secondary, setSecondary] = useState<{ episodeNumber: number; fraction: number } | null>(null);

  // Bumped by the error state's "Try again" to re-run the fetch below
  // for the same season (nothing else about the effect's inputs changes).
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (selected === null) return;
    setLoading(true);
    setError(null);
    getSeason(tvId, selected)
      .then((season) => setEpisodes(season.episodes))
      .catch(() => setError("Couldn't load episodes for this season."))
      .finally(() => setLoading(false));
  }, [tvId, selected, retryNonce]);

  // Deliberately a separate effect (and separate failure mode) from the
  // episode list fetch above: losing the "In progress" highlighting
  // isn't worth erroring or blocking the whole season view over, so a
  // failure here just leaves it unset rather than showing an error.
  // Skipped entirely in the player context — there is no "In progress"
  // slot to compute there, so there's nothing this fetch would be used
  // for (one fewer request on the watch page).
  useEffect(() => {
    if (selected === null || isPlayerContext) {
      setSecondary(null);
      return;
    }
    let cancelled = false;
    getSeasonWatchProgress(tvId, selected)
      .then((rows) => {
        if (cancelled) return;
        const isResume = (season: number, episode: number | null) =>
          resumeEpisode?.season_number === season && resumeEpisode?.episode_number === episode;
        const resumeTime = resumeEpisode?.updated_at ? Date.parse(resumeEpisode.updated_at) : null;

        // "In progress" means: you went BACK to an earlier episode after
        // reaching your furthest one. So an episode only qualifies if it
        // was touched AFTER the resume point was — that's what separates
        // "I dipped back into episode 2" from "episode 8 is where I used
        // to be, before I moved on to 9". Without this, simply advancing
        // from 8 to 9 turned 8 into "In progress", which is not what the
        // label is for.
        const candidates = rows.filter((row) => {
          if (row.episode_number == null || row.duration_seconds <= 0) return false;
          // The resume point itself never takes this slot.
          if (isResume(selected, row.episode_number)) return false;
          if (resumeTime != null && !(Date.parse(row.updated_at) > resumeTime)) return false;
          return row.position_seconds / row.duration_seconds < NEAR_COMPLETE_FRACTION;
        });
        candidates.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
        const mostRecent = candidates[0];
        let chosen: { episodeNumber: number; fraction: number } | null = mostRecent
          ? {
              episodeNumber: mostRecent.episode_number as number,
              fraction: Math.min(1, mostRecent.position_seconds / mostRecent.duration_seconds),
            }
          : null;

        // The episode just left, if it's behind the resume point, is the
        // newest activity by definition — it wins without waiting for its
        // own save to show up in `rows`. Skipped if what we do know says
        // it's finished (nothing to be "in progress" about).
        if (
          recentVisit &&
          recentVisit.seasonNumber === selected &&
          !isResume(recentVisit.seasonNumber, recentVisit.episodeNumber)
        ) {
          const known = rows.find((r) => r.episode_number === recentVisit.episodeNumber);
          const knownFraction =
            known && known.duration_seconds > 0 ? known.position_seconds / known.duration_seconds : null;
          if (knownFraction == null || knownFraction < NEAR_COMPLETE_FRACTION) {
            chosen = { episodeNumber: recentVisit.episodeNumber, fraction: Math.min(1, knownFraction ?? 0) };
          }
        }

        setSecondary(chosen);
      })
      .catch(() => {
        if (!cancelled) setSecondary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [tvId, selected, resumeEpisode, isPlayerContext, recentVisit?.seasonNumber, recentVisit?.episodeNumber]);

  // Saves in the background and navigates immediately — see
  // navigateWithResumeHint's docstring in lib/playback.ts. Detail-page
  // clicks (isPlayerContext false) fall through to the anchor's normal,
  // unintercepted navigation — there's no "currently playing" position
  // to save there.
  function handleEpisodeClick(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
    if (!isPlayerContext || initialSeason == null || currentEpisode == null) return;
    e.preventDefault();
    navigateWithResumeHint(
      { tmdbId: tvId, mediaType: "tv", seasonNumber: initialSeason, episodeNumber: currentEpisode },
      href
    );
  }

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

      {loading && <EpisodeListSkeleton />}
      {error && !loading && (
        <ErrorState compact title="Episodes unavailable" message={error} onRetry={() => setRetryNonce((n) => n + 1)} />
      )}

      {!loading && !error && (
        <ul className="flex flex-col divide-y divide-white/10">
          {episodes.map((episode) => {
            const still = stillUrl(episode.still_path);
            const isNowPlaying = selected === initialSeason && episode.episode_number === currentEpisode;
            const isResumePoint =
              !isNowPlaying &&
              resumeIsAheadOfPlaying &&
              resumeEpisode?.season_number === selected &&
              resumeEpisode?.episode_number === episode.episode_number;
            const isHighlighted = isNowPlaying || isResumePoint;
            const isSecondary = !isPlayerContext && !isHighlighted && secondary?.episodeNumber === episode.episode_number;

            // "Now playing" is always pink — it's the one thing
            // actually happening right now. The resume point gets the
            // same pink treatment when it's the *only* special episode
            // (the detail page, where this was already confirmed to
            // read well) — but on the watch page, if it differs from
            // what's actually playing, two identically pink episodes at
            // once is exactly the confusion this fixes, so it gets a
            // distinct mint color there instead, plus its own label.
            let nameClass = "text-white/90 group-hover:text-white";
            if (isNowPlaying) {
              nameClass = "font-medium text-[#FF5FA2]";
            } else if (isResumePoint) {
              nameClass = isPlayerContext ? "font-medium text-[#8FE3C7]" : "font-medium text-[#FF5FA2]";
            }

            return (
              <li key={episode.episode_number}>
                <a
                  href={`/watch/tv/${tvId}/${selected}/${episode.episode_number}`}
                  onClick={(e) =>
                    handleEpisodeClick(e, `/watch/tv/${tvId}/${selected}/${episode.episode_number}`)
                  }
                  className={`group flex gap-4 py-4 ${isHighlighted ? "-mx-3 rounded-lg bg-white/5 px-3" : ""}`}
                >
                  <div
                    className={`relative h-[68px] w-[120px] shrink-0 overflow-hidden rounded-lg bg-white/5 ${
                      isSecondary ? "ring-1 ring-[#FF5FA2]/50" : ""
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
                    {isSecondary && secondary && (
                      <div className="absolute inset-x-0 bottom-0 h-1 bg-black/50">
                        <div
                          className="h-full bg-[#FF5FA2]"
                          style={{ width: `${Math.round(secondary.fraction * 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className={nameClass}>
                      {episode.episode_number}. {episode.name}
                      {isNowPlaying && <span className="ml-2 text-xs font-normal text-white/50">Now playing</span>}
                      {isResumePoint && isPlayerContext && (
                        <span className="ml-2 text-xs font-normal text-white/50">Last watched</span>
                      )}
                      {isSecondary && (
                        <span className="ml-2 text-xs font-normal text-[#FF5FA2]/80">In progress</span>
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
