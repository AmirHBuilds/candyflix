import DetailRatings from "@/components/DetailRatings";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getMovie, getSimilarMovies, backdropUrl, posterUrl } from "@/lib/media";
import Overview from "@/components/Overview";
import DetailActions from "@/components/DetailActions";
import MediaGrid from "@/components/MediaGrid";

export default async function MovieDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Started together: the similar-titles lookup doesn't depend on the
  // movie's own response, so awaiting them one after the other just added
  // their latencies together. (Caught here, so it can't surface as an
  // unhandled rejection if the movie turns out not to exist.)
  const similarPromise = getSimilarMovies(id).catch(() => []);

  let movie;
  try {
    movie = await getMovie(id);
  } catch {
    notFound();
  }

  const similar = await similarPromise;

  const backdrop = backdropUrl(movie.backdrop_path, "original");
  const poster = posterUrl(movie.poster_path, "w500");

  return (
    <div className="animate-fade-in flex flex-col gap-8">
      <div className="relative -mx-6 h-[40dvh] min-h-[260px] overflow-hidden sm:mx-0 sm:rounded-3xl">
        {backdrop && (
          <Image src={backdrop} alt="" fill priority sizes="100vw" className="object-cover object-top" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-canvas via-canvas/50 to-transparent" />
      </div>

      <div className="flex flex-col gap-6 sm:flex-row">
        {poster && (
          <Image
            src={poster}
            alt={movie.title}
            width={220}
            height={330}
            className="hidden h-auto w-[clamp(150px,20vw,220px)] shrink-0 self-start rounded-xl sm:block"
          />
        )}

        <div className="flex flex-col gap-4">
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
              {movie.title}
            </h1>
            <p className="mt-1 text-white/50">
              {movie.year}
              {movie.runtime_minutes ? ` · ${movie.runtime_minutes} min` : ""}
            </p>
          </div>

          <DetailRatings mediaType="movie" tmdbId={movie.tmdb_id} tmdbRating={movie.rating ?? null} />

          {movie.genres.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {movie.genres.map((genre) => (
                <span
                  key={genre}
                  className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/60"
                >
                  {genre}
                </span>
              ))}
            </div>
          )}

          <Overview text={movie.overview} className="max-w-2xl text-white/70" />

          <DetailActions tmdbId={movie.tmdb_id} mediaType="movie" />
        </div>
      </div>

      {similar.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-medium text-white/90">You May Also Like</h2>
          <MediaGrid items={similar} />
        </section>
      )}
    </div>
  );
}
