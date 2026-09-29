import Image from "next/image";
import { notFound } from "next/navigation";
import { getTVShow, getSimilarTV, backdropUrl, posterUrl, shortenOverview } from "@/lib/media";
import { getLatestTVWatchProgressServer } from "@/lib/playback-server";
import { mergeResumeWithHint, parseResumeHintFromSearchParams } from "@/lib/playback";
import DetailActions from "@/components/DetailActions";
import SeasonBrowser from "@/components/SeasonBrowser";
import MediaGrid from "@/components/MediaGrid";
import StripResumeHintFromUrl from "@/components/player/StripResumeHintFromUrl";

export default async function TVDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;

  let show;
  try {
    show = await getTVShow(id);
  } catch {
    notFound();
  }

  const similar = await getSimilarTV(id).catch(() => []);
  // Not logged in, or nothing watched yet, both land here as null —
  // same "fail toward nothing rather than break the page" treatment as
  // `similar` above. Fetched once here and passed to both DetailActions
  // (Watch Now + its resume label) and SeasonBrowser (which episode's
  // name to show in pink), rather than each fetching it independently.
  // Merged with a URL hint (see lib/playback.ts's navigateWithResumeHint
  // / mergeResumeWithHint) in case the person just navigated here
  // straight from the player and the corresponding save hasn't landed
  // yet — without this, "Back to details" could briefly show a resume
  // point one step behind what was actually just watched.
  const sp = await searchParams;
  const hint = parseResumeHintFromSearchParams(sp);
  const watchProgress = mergeResumeWithHint(
    await getLatestTVWatchProgressServer(show.tmdb_id).catch(() => null),
    hint,
    show.tmdb_id
  );

  const backdrop = backdropUrl(show.backdrop_path, "original");
  const poster = posterUrl(show.poster_path, "w500");

  return (
    <div className="flex flex-col gap-8">
      <StripResumeHintFromUrl />
      <div className="relative -mx-6 h-[40vh] min-h-[260px] overflow-hidden sm:mx-0 sm:rounded-3xl">
        {backdrop && (
          <Image src={backdrop} alt="" fill priority sizes="100vw" className="object-cover object-top" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0B0B12] via-[#0B0B12]/50 to-transparent" />
      </div>

      <div className="flex flex-col gap-6 sm:flex-row">
        {poster && (
          <Image
            src={poster}
            alt={show.title}
            width={220}
            height={330}
            className="hidden shrink-0 rounded-xl sm:block"
          />
        )}

        <div className="flex flex-col gap-4">
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
              {show.title}
            </h1>
            <p className="mt-1 text-white/50">
              {show.year}
              {show.rating ? ` · ★ ${show.rating.toFixed(1)}` : ""}
            </p>
          </div>

          {show.genres.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {show.genres.map((genre) => (
                <span
                  key={genre}
                  className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/60"
                >
                  {genre}
                </span>
              ))}
            </div>
          )}

          <p className="max-w-2xl text-white/70">{shortenOverview(show.overview)}</p>

          <DetailActions tmdbId={show.tmdb_id} mediaType="tv" tvProgress={watchProgress} />
        </div>
      </div>

      <SeasonBrowser
        tvId={show.tmdb_id}
        seasons={show.seasons}
        resumeEpisode={watchProgress}
        recentVisit={hint}
      />

      {similar.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-medium text-white/90">You May Also Like</h2>
          <MediaGrid items={similar} />
        </section>
      )}
    </div>
  );
}
