"use client";

import { useState } from "react";
import MediaGrid from "@/components/MediaGrid";
import AdvancedSearchPanel from "@/components/AdvancedSearchPanel";
import EmptyState from "@/components/EmptyState";
import ErrorState from "@/components/ErrorState";
import { LoadingRegion, MediaGridSkeleton } from "@/components/Skeleton";
import {
  discoverMovies,
  discoverTV,
  getPopularMoviesPage,
  getPopularTVPage,
  type DiscoverFilters,
  type Genre,
  type MediaItem,
} from "@/lib/media";

type MediaType = "movie" | "tv";

function isFiltersActive(filters: DiscoverFilters): boolean {
  return (
    filters.genre !== undefined ||
    filters.year !== undefined ||
    filters.minRating !== undefined ||
    (filters.sort !== undefined && filters.sort !== "popularity")
  );
}

export default function MediaBrowser({
  mediaType,
  genres,
  initialItems,
  initialHasMore,
  emptyLabel,
  errorLabel,
}: {
  mediaType: MediaType;
  genres: Genre[];
  initialItems: MediaItem[];
  initialHasMore: boolean;
  emptyLabel: string;
  errorLabel: string;
}) {
  const [items, setItems] = useState(initialItems);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  // True only while a whole new result set (filters applied/cleared) is
  // loading, as opposed to "Load More" appending to the current one.
  const [replacing, setReplacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<DiscoverFilters>({});
  const filtersActive = isFiltersActive(filters);

  const fetchPage = (targetPage: number, activeFilters: DiscoverFilters) => {
    if (mediaType === "movie") {
      return isFiltersActive(activeFilters)
        ? discoverMovies(targetPage, activeFilters)
        : getPopularMoviesPage(targetPage);
    }
    return isFiltersActive(activeFilters)
      ? discoverTV(targetPage, activeFilters)
      : getPopularTVPage(targetPage);
  };

  async function loadMore() {
    setLoading(true);
    setError(null);
    try {
      const nextPage = page + 1;
      const result = await fetchPage(nextPage, filters);
      setItems((prev) => [...prev, ...result.items]);
      setHasMore(result.hasMore);
      setPage(nextPage);
    } catch {
      setError(errorLabel);
    } finally {
      setLoading(false);
    }
  }

  async function applyFilters(newFilters: DiscoverFilters) {
    setLoading(true);
    setReplacing(true);
    setError(null);
    setFilters(newFilters);
    try {
      const result = await fetchPage(1, newFilters);
      setItems(result.items);
      setHasMore(result.hasMore);
      setPage(1);
    } catch {
      setError(errorLabel);
    } finally {
      setLoading(false);
      setReplacing(false);
    }
  }

  async function clearFilters() {
    setLoading(true);
    setReplacing(true);
    setError(null);
    setFilters({});
    try {
      const result = await fetchPage(1, {});
      setItems(result.items);
      setHasMore(result.hasMore);
      setPage(1);
    } catch {
      setError(errorLabel);
    } finally {
      setLoading(false);
      setReplacing(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <AdvancedSearchPanel
        genres={genres}
        onApply={applyFilters}
        onClear={clearFilters}
        hasActiveFilters={filtersActive}
      />

      {error && (
        <ErrorState
          compact
          message={error}
          // Redo whichever request failed: the first page of the current
          // filters if nothing is showing, otherwise the next page.
          onRetry={() => (items.length === 0 ? applyFilters(filters) : loadMore())}
        />
      )}

      {!error && items.length === 0 && !loading && (
        <EmptyState
          compact
          icon="search"
          title="Nothing to show"
          message={emptyLabel}
          action={filtersActive ? { label: "Clear filters", onClick: clearFilters } : undefined}
        />
      )}

      {/* While a new filter set is loading the old results are stale, so
          swap in placeholders; while paging, keep what's there and
          append placeholders after it. */}
      {replacing ? (
        <LoadingRegion>
          <MediaGridSkeleton count={12} />
        </LoadingRegion>
      ) : (
        <MediaGrid items={items} />
      )}
      {loading && !replacing && (
        <LoadingRegion>
          <MediaGridSkeleton count={6} />
        </LoadingRegion>
      )}

      {hasMore && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loading}
          className="mx-auto rounded-xl border border-white/10 px-6 py-3 text-sm font-medium text-white/80 hover:bg-white/5 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Load More"}
        </button>
      )}
    </div>
  );
}
