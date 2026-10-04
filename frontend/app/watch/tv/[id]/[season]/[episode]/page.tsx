import { getTVShow, getSeason, type TVShowDetail, type SeasonDetail } from "@/lib/media";
import { getEpisodePlaybackSourceServer, getLatestTVWatchProgressServer } from "@/lib/playback-server";
import { mergeResumeWithHint, parseResumeHintFromSearchParams, type PlaybackSource } from "@/lib/playback";
import VideoPlayer from "@/components/player/VideoPlayer";
import SeasonBrowser from "@/components/SeasonBrowser";
import BackToDetailsLink from "@/components/player/BackToDetailsLink";
import StripResumeHintFromUrl from "@/components/player/StripResumeHintFromUrl";
import ErrorState from "@/components/ErrorState";
import { findAdjacentEpisodes } from "@/lib/next-episode";

export default async function WatchEpisodePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; season: string; episode: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id, season, episode } = await params;
  const seasonNum = Number(season);
  const episodeNum = Number(episode);

  let show: TVShowDetail | undefined;
  let seasonDetail: SeasonDetail | undefined;
  let source: PlaybackSource | undefined;
  let error: string | null = null;
  try {
    [show, seasonDetail, source] = await Promise.all([
      getTVShow(id),
      getSeason(id, seasonNum),
      getEpisodePlaybackSourceServer(id, seasonNum, episodeNum),
    ]);
  } catch (e) {
    error = e instanceof Error ? e.message : "Couldn't load this video.";
  }

  if (error || !show || !seasonDetail || !source) {
    return (
      <div className="flex min-h-[70dvh] items-center justify-center px-6">
        <ErrorState
          title="Couldn't start playback"
          message={error ?? "Couldn't load this video."}
          secondary={{ label: "Back to details", href: `/tv/${id}` }}
        />
      </div>
    );
  }

  // The show's overall resume point — not necessarily this episode; the
  // person may have jumped here from an older/different one. Passed to
  // SeasonBrowser so that episode (if different from the one actually
  // playing) still gets its own pink-name treatment below, instead of
  // being demoted to the generic "In progress" label the way any other
  // merely-partial episode is. Merged with a URL hint (see
  // lib/playback.ts's navigateWithResumeHint / mergeResumeWithHint) for
  // the same reason as the detail page: the save for the episode just
  // left might not have landed by the time this page's own data fetch
  // runs, and this hint is how that stays correct without waiting on it.
  const sp = await searchParams;
  const resumeProgress = mergeResumeWithHint(
    await getLatestTVWatchProgressServer(show.tmdb_id).catch(() => null),
    parseResumeHintFromSearchParams(sp),
    show.tmdb_id
  );

  const episodes = seasonDetail.episodes;
  const currentEpisode = episodes.find((e) => e.episode_number === episodeNum) ?? null;

  // The neighbouring episodes, rolling over season boundaries (see
  // lib/next-episode.ts for the rules: no specials, nothing unaired, and
  // the last episode of the series has no "next").
  const { prev, next } = await findAdjacentEpisodes({
    seasons: show.seasons,
    seasonNumber: seasonNum,
    episodes,
    episodeNumber: episodeNum,
    loadSeason: (n) => getSeason(id, n),
  }).catch(() => ({ prev: null, next: null }));
  const prevEp = prev?.episode ?? null;
  const prevSeasonNum = prev?.season ?? seasonNum;
  const nextEp = next?.episode ?? null;
  const nextSeasonNum = next?.season ?? seasonNum;

  return (
    <div>
      <StripResumeHintFromUrl />
      <VideoPlayer
        source={source}
        title={`${show.title} — ${currentEpisode?.name ?? `Episode ${episodeNum}`}`}
        identity={{
          tmdbId: show.tmdb_id,
          mediaType: "tv",
          seasonNumber: seasonNum,
          episodeNumber: episodeNum,
        }}
        backHref={`/tv/${show.tmdb_id}`}
        prevEpisode={
          prevEp
            ? {
                href: `/watch/tv/${show.tmdb_id}/${prevSeasonNum}/${prevEp.episode_number}`,
                label: prevEp.name,
              }
            : null
        }
        nextEpisode={
          nextEp
            ? {
                href: `/watch/tv/${show.tmdb_id}/${nextSeasonNum}/${nextEp.episode_number}`,
                label: nextEp.name,
              }
            : null
        }
      />
      <div className="p-6">
        <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold text-white">
          {show.title}
        </h1>
        <p className="text-white/60">
          S{seasonNum}E{episodeNum} · {currentEpisode?.name}
        </p>
        <BackToDetailsLink
          identity={{ tmdbId: show.tmdb_id, mediaType: "tv", seasonNumber: seasonNum, episodeNumber: episodeNum }}
          href={`/tv/${show.tmdb_id}`}
          className="text-sm text-white/50 hover:text-white/80"
        >
          ← Back to details
        </BackToDetailsLink>
      </div>
      <div className="px-6 pb-10">
        <h2 className="mb-4 font-[family-name:var(--font-display)] text-lg font-semibold text-white">
          Episodes
        </h2>
        <SeasonBrowser
          tvId={show.tmdb_id}
          seasons={show.seasons}
          initialSeason={seasonNum}
          currentEpisode={episodeNum}
          resumeEpisode={resumeProgress}
        />
      </div>
    </div>
  );
}
