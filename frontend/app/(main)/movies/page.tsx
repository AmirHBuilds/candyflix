import { getMovieGenres, getPopularMoviesPage, type Genre, type MediaItem } from "@/lib/media";
import MediaBrowser from "@/components/MediaBrowser";

export default async function MoviesPage() {
  let items: MediaItem[] = [];
  let hasMore = false;
  let genres: Genre[] = [];
  let error: string | null = null;

  try {
    const [page, genreList] = await Promise.all([getPopularMoviesPage(1), getMovieGenres()]);
    items = page.items;
    hasMore = page.hasMore;
    genres = genreList;
  } catch {
    error = "Couldn't load movies right now. Try refreshing in a moment.";
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold">Movies</h1>
      {error ? (
        <p className="text-[#FF5FA2]">{error}</p>
      ) : (
        <MediaBrowser
          mediaType="movie"
          genres={genres}
          initialItems={items}
          initialHasMore={hasMore}
          emptyLabel="No movies match your filters."
          errorLabel="Couldn't load more movies right now. Try again in a moment."
        />
      )}
    </div>
  );
}
