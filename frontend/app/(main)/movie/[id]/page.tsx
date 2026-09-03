import Image from "next/image";
import { notFound } from "next/navigation";
import { getMovie, backdropUrl, posterUrl } from "@/lib/media";
import DetailActions from "@/components/DetailActions";

export default async function MovieDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let movie;
  try {
    movie = await getMovie(id);
  } catch {
    notFound();
  }

  const backdrop = backdropUrl(movie.backdrop_path);
  const poster = posterUrl(movie.poster_path, "w500");

  return (
    <div className="flex flex-col gap-8">
      <div className="relative -mx-6 h-[40vh] min-h-[260px] overflow-hidden sm:mx-0 sm:rounded-3xl">
        {backdrop && (
          <Image src={backdrop} alt="" fill priority sizes="100vw" className="object-cover" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0B0B12] via-[#0B0B12]/50 to-transparent" />
      </div>

      <div className="flex flex-col gap-6 sm:flex-row">
        {poster && (
          <Image
            src={poster}
            alt={movie.title}
            width={220}
            height={330}
            className="hidden shrink-0 rounded-xl sm:block"
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
              {movie.rating ? ` · ★ ${movie.rating.toFixed(1)}` : ""}
            </p>
          </div>

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

          <p className="max-w-2xl text-white/70">{movie.overview}</p>

          <DetailActions />
        </div>
      </div>
    </div>
  );
}
