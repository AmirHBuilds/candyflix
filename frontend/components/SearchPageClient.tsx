"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useDebouncedSearch } from "@/lib/useDebouncedSearch";
import MediaGrid from "@/components/MediaGrid";

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

  return (
    <div className="flex flex-col gap-6">
      <input
        type="text"
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="What do you want to watch?"
        className="w-full max-w-xl rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white placeholder-white/30 outline-none focus:border-[#FF5FA2]/60"
      />

      {loading && <p className="text-white/40">Searching…</p>}
      {error && <p className="text-[#FF5FA2]">{error}</p>}

      {!loading && !error && query.trim().length > 0 && results.length === 0 && (
        <p className="text-white/50">No matches for &quot;{query.trim()}&quot;.</p>
      )}

      <MediaGrid items={results} />
    </div>
  );
}
