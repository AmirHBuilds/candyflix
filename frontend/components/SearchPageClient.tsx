"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useDebouncedSearch } from "@/lib/useDebouncedSearch";
import MediaGrid from "@/components/MediaGrid";
import EmptyState from "@/components/EmptyState";
import ErrorState from "@/components/ErrorState";
import AskAIButton from "@/components/AskAIButton";
import { looksLikeRequest } from "@/lib/ai";
import { useAIAvailable } from "@/lib/use-ai-available";
import { LoadingRegion, MediaGridSkeleton } from "@/components/Skeleton";

export default function SearchPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";

  const [query, setQuery] = useState(urlQuery);

  // Keep the input in sync when the URL changes from outside this
  // component (browser back/forward, or a link like /search?q=...).
  useEffect(() => {
    setQuery(urlQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQuery]);

  const { results, loading, error } = useDebouncedSearch(query, 300);

  // Reflect the query into the URL (debounced, and via replace so
  // fast typing doesn't spam browser history) so the page is always
  // refreshable/shareable/bookmarkable.
  useEffect(() => {
    const trimmed = query.trim();
    const timeout = setTimeout(() => {
      const current = searchParams.get("q") ?? "";
      if (trimmed === current) return;
      const url = trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : "/search";
      router.replace(url, { scroll: false });
    }, 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const aiAvailable = useAIAvailable(query.trim().length >= 3);

  return (
    <div className="flex flex-col gap-6">
      <input
        type="text"
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="What do you want to watch?"
        className="w-full max-w-xl rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white placeholder-white/30 outline-none focus:border-accent/60"
      />

      {loading && results.length === 0 && (
        <LoadingRegion>
          <MediaGridSkeleton count={6} />
        </LoadingRegion>
      )}
      {loading && results.length > 0 && <p className="text-sm text-white/40">Searching…</p>}
      {error && <ErrorState compact retry={false} message={error} />}

      {!loading && !error && query.trim().length > 0 && results.length === 0 && (
        <EmptyState
          compact
          icon="search"
          title={`No matches for “${query.trim()}”`}
          message="Check the spelling, or try a different title."
        />
      )}
      {!loading && !error && aiAvailable && query.trim().length >= 3 && (results.length === 0 || looksLikeRequest(query)) && (
        <AskAIButton
          query={query.trim()}
          hint={results.length === 0 ? "find it for me" : "get suggestions"}
          onClick={() => router.push(`/ask?q=${encodeURIComponent(query.trim())}`)}
        />
      )}

      <MediaGrid items={results} />
    </div>
  );
}
