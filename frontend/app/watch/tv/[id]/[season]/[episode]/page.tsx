import { getTVShow, getSeason, type TVShowDetail, type SeasonDetail } from "@/lib/media";
import { getEpisodePlaybackSource, type PlaybackSource } from "@/lib/playback";
import VideoPlayer from "@/components/player/VideoPlayer";

export default async function WatchEpisodePage({
  params,
}: {
  params: Promise<{ id: string; season: string; episode: string }>;
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
      getEpisodePlaybackSource(id, seasonNum, episodeNum),
    ]);
  } catch (e) {
    error = e instanceof Error ? e.message : "Couldn't load this video.";
  }

  if (error || !show || !seasonDetail || !source) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center text-white">
        <p className="text-white/70">{error}</p>
        <a href={`/tv/${id}`} className="text-[#C9A6FF] underline">
          Back to details
        </a>
      </div>
    );
  }

  const episodes = seasonDetail.episodes;
  const currentIndex = episodes.findIndex((e) => e.episode_number === episodeNum);
  const currentEpisode = currentIndex >= 0 ? episodes[currentIndex] : null;
  const prevEp = currentIndex > 0 ? episodes[currentIndex - 1] : null;
  // NOTE: only looks within the current season — rolling over into the
  // next season's episode 1 is a reasonable Phase 5b/later addition,
  // not built now (keeps this phase's scope contained).
  const nextEp = currentIndex >= 0 && currentIndex < episodes.length - 1 ? episodes[currentIndex + 1] : null;

  return (
    <div>
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
                href: `/watch/tv/${show.tmdb_id}/${seasonNum}/${prevEp.episode_number}`,
                label: prevEp.name,
              }
            : null
        }
        nextEpisode={
          nextEp
            ? {
                href: `/watch/tv/${show.tmdb_id}/${seasonNum}/${nextEp.episode_number}`,
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
        <a href={`/tv/${show.tmdb_id}`} className="text-sm text-white/50 hover:text-white/80">
          ← Back to details
        </a>
      </div>
    </div>
  );
}
