"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDebouncedSearch } from "@/lib/useDebouncedSearch";
import MediaGrid from "@/components/MediaGrid";

const MAX_LIVE_RESULTS = 12;

export default function NavSearch() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const { results, loading, error } = useDebouncedSearch(query, 300);
  const trimmed = query.trim();
  const visible = results.slice(0, MAX_LIVE_RESULTS);
  const hasMore = results.length > MAX_LIVE_RESULTS;

  useEffect(() => {
    setOpen(trimmed.length > 0);
  }, [trimmed]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function goToFullSearch() {
    if (trimmed.length === 0) return;
    setOpen(false);
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      goToFullSearch();
    }
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => trimmed.length > 0 && setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="What do you want to watch?"
        aria-label="Search"
        className="w-full rounded-full border border-white/10 bg-white/[0.06] px-5 py-3 text-white placeholder-white/30 outline-none focus:border-[#FF5FA2]/60"
      />

      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-3 max-h-[80vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0E0E17]/98 p-5 shadow-2xl backdrop-blur-xl sm:p-6">
          {loading && <p className="py-6 text-center text-white/40">Searching…</p>}

          {!loading && error && (
            <p className="py-6 text-center text-[#FF5FA2]">{error}</p>
          )}

          {!loading && !error && visible.length === 0 && (
            <p className="py-6 text-center text-white/50">
              No matches for &quot;{trimmed}&quot;.
            </p>
          )}

          {!loading && !error && visible.length > 0 && (
            <>
              <MediaGrid items={visible} onNavigate={() => setOpen(false)} />
              {hasMore && (
                <button
                  type="button"
                  onClick={goToFullSearch}
                  className="mt-5 w-full rounded-xl border border-white/10 py-3 text-center text-sm font-medium text-[#FF5FA2] hover:bg-white/5"
                >
                  See all results for &quot;{trimmed}&quot;
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
