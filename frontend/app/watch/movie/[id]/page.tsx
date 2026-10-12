import { backdropUrl, getMovie, type MovieDetail } from "@/lib/media";
import { authInit } from "@/lib/media-server";
import { getMoviePlaybackSourceServer } from "@/lib/playback-server";
import type { PlaybackSource } from "@/lib/playback";
import VideoPlayer from "@/components/player/VideoPlayer";
import ResolverPlayer from "@/components/player/ResolverPlayer";
import PlayerSocial from "@/components/opinions/PlayerSocial";
import BackToDetailsLink from "@/components/player/BackToDetailsLink";
import ErrorState from "@/components/ErrorState";

export default async function WatchMoviePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let movie: MovieDetail | undefined;
  let source: PlaybackSource | undefined;
  let error: string | null = null;
  try {
    [movie, source] = await Promise.all([getMovie(id, await authInit()), getMoviePlaybackSourceServer(id)]);
  } catch (e) {
    error = e instanceof Error ? e.message : "Couldn't load this video.";
  }

  if (error || !movie || !source) {
    return (
      <div className="flex min-h-[70dvh] items-center justify-center px-6">
        <ErrorState
          title="Couldn't start playback"
          message={error ?? "Couldn't load this video."}
          secondary={{ label: "Back to details", href: `/movie/${id}` }}
        />
      </div>
    );
  }

  return (
    <div>
      {source.source_type === "resolver" ? (
        <ResolverPlayer
          source={source}
          title={movie.title}
          identity={{ tmdbId: movie.tmdb_id, mediaType: "movie" }}
          backHref={`/movie/${movie.tmdb_id}`}
          artwork={backdropUrl(movie.backdrop_path)}
        />
      ) : (
        <VideoPlayer
          source={source}
          title={movie.title}
          identity={{ tmdbId: movie.tmdb_id, mediaType: "movie" }}
          backHref={`/movie/${movie.tmdb_id}`}
        />
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4 p-6">
        <div className="min-w-0">
          <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold text-white">
            {movie.title}
          </h1>
          <BackToDetailsLink
            identity={{ tmdbId: movie.tmdb_id, mediaType: "movie" }}
            href={`/movie/${movie.tmdb_id}`}
            className="text-sm text-white/50 hover:text-white/80"
          >
            ← Back to details
          </BackToDetailsLink>
        </div>
        <PlayerSocial scope={{ media_type: "movie", tmdb_id: movie.tmdb_id }} title={movie.title} />
      </div>
    </div>
  );
}
