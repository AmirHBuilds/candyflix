"use client";

import { useState } from "react";
import MediaGrid from "@/components/MediaGrid";
import AdvancedSearchPanel from "@/components/AdvancedSearchPanel";
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
    }
  }

  async function clearFilters() {
    setLoading(true);
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

      {error && <p className="text-[#FF5FA2]">{error}</p>}

      {!error && items.length === 0 && !loading && <p className="text-white/50">{emptyLabel}</p>}

      <MediaGrid items={items} />

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
