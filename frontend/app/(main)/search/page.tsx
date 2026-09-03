"use client";

import { useEffect, useState } from "react";
import { searchMedia, type MediaItem } from "@/lib/media";
import MediaGrid from "@/components/MediaGrid";

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setResults([]);
      setError(null);
      return;
    }

    setLoading(true);
    const timeout = setTimeout(() => {
      searchMedia(trimmed)
        .then((items) => {
          setResults(items);
          setError(null);
        })
        .catch(() => setError("Search is unavailable right now."))
        .finally(() => setLoading(false));
    }, 400);

    return () => clearTimeout(timeout);
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
