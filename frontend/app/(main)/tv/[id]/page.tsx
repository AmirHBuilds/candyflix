import RatingsButton from "@/components/RatingsButton";
import TrailerButton from "@/components/TrailerButton";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getTVShow, getSimilarTV, backdropUrl, posterUrl, NotAllowedError } from "@/lib/media";
import { authInit } from "@/lib/media-server";
import ErrorState from "@/components/ErrorState";
import { getLatestTVWatchProgressServer } from "@/lib/playback-server";
import { mergeResumeWithHint, parseResumeHintFromSearchParams } from "@/lib/playback";
import Overview from "@/components/Overview";
import DetailActions from "@/components/DetailActions";
import SeasonBrowser from "@/components/SeasonBrowser";
import OpinionsSection from "@/components/opinions/OpinionsSection";
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

  // The show, its similar titles and the viewer's latest progress don't
  // depend on each other's responses, so all three start together instead
  // of waiting in a line. Both side requests are caught on the spot, so
  // neither can become an unhandled rejection if the show doesn't exist.
  const auth = await authInit();
  const similarPromise = getSimilarTV(id, auth).catch(() => []);
  const progressPromise = getLatestTVWatchProgressServer(Number(id)).catch(() => null);

  let show;
  try {
    show = await getTVShow(id, auth);
  } catch (e) {
    if (e instanceof NotAllowedError) {
      void similarPromise;
      return (
        <div className="flex min-h-[60dvh] items-center justify-center">
          <ErrorState title="Not available" message={e.message} secondary={{ label: "Back home", href: "/" }} />
        </div>
      );
    }
    notFound();
  }

  const similar = await similarPromise;
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
  const watchProgress = mergeResumeWithHint(await progressPromise, hint, show.tmdb_id);

  const backdrop = backdropUrl(show.backdrop_path, "original");
  const poster = posterUrl(show.poster_path, "w500");

  return (
    <div className="animate-fade-in flex flex-col gap-8">
      <StripResumeHintFromUrl />
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
            alt={show.title}
            width={220}
            height={330}
            className="hidden h-auto w-[clamp(150px,20vw,220px)] shrink-0 self-start rounded-xl sm:block"
          />
        )}

        <div className="flex flex-col gap-4">
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
              {show.title}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-white/50">
              <span>{show.year}</span>
              <RatingsButton mediaType="tv" tmdbId={show.tmdb_id} tmdbRating={show.rating ?? null} />
              {show.trailer_key && <TrailerButton youtubeKey={show.trailer_key} title={show.title} />}
            </div>
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

          <Overview text={show.overview} className="max-w-2xl text-white/70" />

          <DetailActions tmdbId={show.tmdb_id} mediaType="tv" tvProgress={watchProgress} />
        </div>
      </div>

      <SeasonBrowser
        tvId={show.tmdb_id}
        seasons={show.seasons}
        resumeEpisode={watchProgress}
        recentVisit={hint}
      />

      <OpinionsSection mediaType="tv" tmdbId={show.tmdb_id} />

      {similar.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-medium text-white/90">You May Also Like</h2>
          <MediaGrid items={similar} />
        </section>
      )}
    </div>
  );
}
