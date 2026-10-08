"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDebouncedSearch } from "@/lib/useDebouncedSearch";
import MediaGrid from "@/components/MediaGrid";
import { LoadingRegion, MediaGridSkeleton } from "@/components/Skeleton";
import AskAIButton from "@/components/AskAIButton";
import { looksLikeRequest } from "@/lib/ai";
import { useAIAvailable } from "@/lib/use-ai-available";

const MAX_LIVE_RESULTS = 12;

// autoFocus: the player reveals this box on demand, so the person
// should be able to type straight away. Elsewhere it's always on
// screen and must not steal focus on page load.
export default function NavSearch({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  // Ask AI is offered only when the server has it set up and this person may use it (looked up
  // the first time they type, so a page that never searches never asks).
  const aiAvailable = useAIAvailable(query.trim().length > 0);

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

  function goToAsk() {
    if (trimmed.length < 3) return;
    setOpen(false);
    router.push(`/ask?q=${encodeURIComponent(trimmed)}`);
  }
  const noMatches = !loading && !error && visible.length === 0 && trimmed.length >= 3;
  // A long description is a request, and a search that found nothing may just be a typo: both get the big button.
  const suggestAI = aiAvailable && trimmed.length >= 3 && (looksLikeRequest(trimmed) || noMatches);

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
      <div className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => trimmed.length > 0 && setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="What do you want to watch?"
        aria-label="Search"
        autoFocus={autoFocus}
        // Phone keyboards: label the return key "Search", and stop
        // auto-capitalising / auto-correcting what is a movie title.
        enterKeyHint="search"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        // Below `sm` the box is edge to edge (see Nav), so square
        // corners and no side borders — a rounded, bordered pill would
        // look clipped against the screen edges.
        className={`w-full rounded-full border border-white/10 bg-white/[0.06] py-3 pl-5 text-white placeholder-white/30 outline-none focus:border-accent/60 max-sm:rounded-none max-sm:border-x-0 ${aiAvailable ? "pr-12" : "pr-5"}`}
      />
      {aiAvailable && (
        <button
          type="button"
          onClick={goToAsk}
          disabled={trimmed.length < 3}
          aria-label="Ask AI"
          title="Ask AI to suggest something"
          className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-accent transition-colors hover:bg-accent/15 disabled:cursor-default disabled:text-white/25 disabled:hover:bg-transparent max-sm:right-3"
        >
          <SparkleIcon />
        </button>
      )}
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-3 max-h-[80dvh] overflow-y-auto rounded-2xl border border-white/10 max-sm:rounded-none max-sm:border-x-0 bg-surface-deep/98 p-5 shadow-2xl backdrop-blur-xl sm:p-6">
          {/* Placeholder cards while the first results load; on later
              keystrokes the previous results stay put (see
              useDebouncedSearch) and a quiet line says it's refreshing. */}
          {suggestAI && (
            <div className="mb-4">
              <AskAIButton query={trimmed} onClick={goToAsk} hint={noMatches ? "find it for me" : "get suggestions"} />
            </div>
          )}

          {loading && visible.length === 0 && (
            <LoadingRegion>
              <MediaGridSkeleton count={6} />
            </LoadingRegion>
          )}
          {loading && visible.length > 0 && (
            <p className="pb-3 text-center text-sm text-white/40">Searching…</p>
          )}

          {!loading && error && (
            <p className="py-6 text-center text-accent">{error}</p>
          )}

          {!loading && !error && visible.length === 0 && (
            <p className="py-6 text-center text-white/50">
              No matches for &quot;{trimmed}&quot;.{suggestAI ? " Maybe a typo?" : ""}
            </p>
          )}

          {!error && visible.length > 0 && (
            <>
              <MediaGrid items={visible} onNavigate={() => setOpen(false)} />
              {hasMore && (
                <button
                  type="button"
                  onClick={goToFullSearch}
                  className="mt-5 w-full rounded-xl border border-white/10 py-3 text-center text-sm font-medium text-accent hover:bg-white/5"
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

export function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
      <path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9z" />
      <path d="M19 15l.9 2.6 2.6.9-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9z" />
    </svg>
  );
}
