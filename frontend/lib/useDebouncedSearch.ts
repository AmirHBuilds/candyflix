"use client";

import { useEffect, useRef, useState } from "react";
import { searchMedia, type MediaItem } from "@/lib/media";

/**
 * Debounces `query`, fetches search results, and guards against two
 * classic race conditions:
 * - aborts the in-flight request when a newer one starts
 * - ignores a response that arrives after the query has already
 *   changed again (belt-and-suspenders alongside the abort)
 */
export function useDebouncedSearch(query: string, delayMs = 300) {
  const [results, setResults] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const controllerRef = useRef<AbortController | null>(null);
  const latestQueryRef = useRef("");

  useEffect(() => {
    const trimmed = query.trim();
    latestQueryRef.current = trimmed;

    controllerRef.current?.abort();

    if (trimmed.length === 0) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const timeout = setTimeout(() => {
      const controller = new AbortController();
      controllerRef.current = controller;

      searchMedia(trimmed, controller.signal)
        .then((items) => {
          if (latestQueryRef.current !== trimmed) return; // stale response
          setResults(items);
          setError(null);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          if (latestQueryRef.current !== trimmed) return;
          setError("Search is unavailable right now.");
        })
        .finally(() => {
          if (latestQueryRef.current === trimmed) setLoading(false);
        });
    }, delayMs);

    return () => clearTimeout(timeout);
  }, [query, delayMs]);

  return { results, loading, error };
}
