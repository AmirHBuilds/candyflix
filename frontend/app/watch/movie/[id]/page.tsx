import { getMovie, type MovieDetail } from "@/lib/media";
import { getMoviePlaybackSourceServer } from "@/lib/playback-server";
import type { PlaybackSource } from "@/lib/playback";
import VideoPlayer from "@/components/player/VideoPlayer";

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
    [movie, source] = await Promise.all([getMovie(id), getMoviePlaybackSourceServer(id)]);
  } catch (e) {
    error = e instanceof Error ? e.message : "Couldn't load this video.";
  }

  if (error || !movie || !source) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center text-white">
        <p className="text-white/70">{error}</p>
        <a href={`/movie/${id}`} className="text-[#C9A6FF] underline">
          Back to details
        </a>
      </div>
    );
  }

  return (
    <div>
      <VideoPlayer
        source={source}
        title={movie.title}
        identity={{ tmdbId: movie.tmdb_id, mediaType: "movie" }}
        backHref={`/movie/${movie.tmdb_id}`}
      />
      <div className="p-6">
        <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold text-white">
          {movie.title}
        </h1>
        <a href={`/movie/${movie.tmdb_id}`} className="text-sm text-white/50 hover:text-white/80">
          ← Back to details
        </a>
      </div>
    </div>
  );
}
