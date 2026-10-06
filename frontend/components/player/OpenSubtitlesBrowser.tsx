"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SubtitleRow from "@/components/player/SubtitleRow";
import type { WatchIdentity } from "@/components/player/useWatchProgress";
import { SUBTITLE_LANGUAGES } from "@/lib/languages";
import {
  downloadOnlineSubtitle,
  searchOnlineSubtitles,
  type OnlineSubtitleResult,
  type SubtitleTrack,
} from "@/lib/playback";

export type LanguageGroup = { language: string; label: string; items: OnlineSubtitleResult[] };

/** Groups results by language. Inside a group: most downloaded first. Groups: the one with the most-downloaded file first. */
export function groupByLanguage(results: OnlineSubtitleResult[]): LanguageGroup[] {
  const map = new Map<string, LanguageGroup>();
  for (const r of results) {
    const g = map.get(r.language) ?? { language: r.language, label: r.label, items: [] };
    g.items.push(r);
    map.set(r.language, g);
  }
  const groups = [...map.values()];
  for (const g of groups) g.items.sort((a, b) => b.downloads - a.downloads);
  groups.sort((a, b) => b.items[0].downloads - a.items[0].downloads);
  return groups;
}

/** "bluray" stays a release search; "persian", "Persian", "fa" or "pt-br" become a language filter. */
export function languageCodeForQuery(query: string): string | null {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return null;
  const hit = SUBTITLE_LANGUAGES.find(
    (l) => l.code === q || l.label.toLowerCase().split(" (")[0] === q || l.label.toLowerCase().includes(`(${q})`)
  );
  return hit ? hit.code : null;
}

export function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

const DEBOUNCE_MS = 450;

// Browse and search OpenSubtitles for this title in the same menu: results are grouped by
// language (a flag on every row), most downloaded first, and picking one downloads it and
// switches to it. The search box looks up languages ("persian") and release names ("bluray").
export default function OpenSubtitlesBrowser({
  identity,
  activeUrl,
  onPicked,
}: {
  identity: WatchIdentity;
  activeUrl: string | null;
  onPicked: (track: SubtitleTrack) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OnlineSubtitleResult[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickingId, setPickingId] = useState<number | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const requestId = useRef(0);

  const run = useCallback(
    async (q: string, pageNumber: number) => {
      const id = ++requestId.current;
      const language = languageCodeForQuery(q);
      const text = q.trim();
      try {
        const res = await searchOnlineSubtitles({
          mediaType: identity.mediaType,
          tmdbId: identity.tmdbId,
          seasonNumber: identity.seasonNumber,
          episodeNumber: identity.episodeNumber,
          language: language ?? undefined,
          query: !language && text ? text : undefined,
          page: pageNumber,
        });
        if (id !== requestId.current) return; // a newer search replaced this one
        setResults((prev) => {
          if (pageNumber === 1) return res.results;
          const seen = new Set(prev.map((r) => r.file_id));
          return [...prev, ...res.results.filter((r) => !seen.has(r.file_id))];
        });
        setPage(pageNumber);
        setHasMore(res.hasMore);
        setError(null);
      } catch (e) {
        if (id !== requestId.current) return;
        setError(e instanceof Error ? e.message : "Couldn't reach OpenSubtitles.");
        if (pageNumber === 1) setResults([]);
      } finally {
        if (id === requestId.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [identity.mediaType, identity.tmdbId, identity.seasonNumber, identity.episodeNumber]
  );

  // First load immediately; later keystrokes wait for a pause in typing.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      void run("", 1);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => void run(query, 1), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, run]);

  async function pick(r: OnlineSubtitleResult) {
    setPickingId(r.file_id);
    setPickError(null);
    try {
      const track = await downloadOnlineSubtitle({
        mediaType: identity.mediaType,
        tmdbId: identity.tmdbId,
        seasonNumber: identity.seasonNumber,
        episodeNumber: identity.episodeNumber,
        fileId: r.file_id,
        language: r.language,
        label: r.label,
      });
      onPicked(track);
    } catch (e) {
      setPickError(e instanceof Error ? e.message : "Couldn't download that subtitle.");
    } finally {
      setPickingId(null);
    }
  }

  const groups = groupByLanguage(results);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a language or release, e.g. persian, bluray"
          aria-label="Search OpenSubtitles"
          className="w-full rounded-xl border border-white/10 bg-white/[0.06] py-2.5 pl-9 pr-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-accent/60"
        />
      </div>

      {pickError && <p className="text-xs text-red-400">{pickError}</p>}

      {loading && results.length === 0 ? (
        <div className="flex flex-col gap-2" aria-label="Loading subtitles">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-white/[0.05]" />
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-start gap-2 rounded-xl bg-white/[0.04] p-3">
          <p className="text-sm text-red-400">{error}</p>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              void run(query, 1);
            }}
            className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20"
          >
            Try again
          </button>
        </div>
      ) : groups.length === 0 ? (
        <p className="rounded-xl bg-white/[0.04] p-4 text-center text-sm text-white/50">
          {query.trim() ? `No subtitles found for “${query.trim()}”.` : "No subtitles found for this title."}
        </p>
      ) : (
        <div className={`flex flex-col gap-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
          {groups.map((g) => (
            <section key={g.language} aria-label={g.label} className="flex flex-col gap-1.5">
              <h4 className="flex items-baseline gap-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-white/45">
                {g.label}
                <span className="font-normal normal-case tracking-normal text-white/30">{g.items.length}</span>
              </h4>
              {g.items.map((r) => (
                <SubtitleRow
                  key={r.file_id}
                  language={r.language}
                  title={r.release ? shortRelease(r.release) : r.label}
                  detail={r.release && shortRelease(r.release) !== r.release.replace(/[._]+/g, " ").trim() ? r.release : null}
                  badges={r.hearing_impaired ? ["HI"] : undefined}
                  active={!!activeUrl && new RegExp(`-${r.file_id}\\.srt$`).test(activeUrl)}
                  busy={pickingId === r.file_id}
                  disabled={pickingId !== null}
                  onClick={() => void pick(r)}
                  trailing={
                    <span className="flex items-center gap-1 tabular-nums" title={`${r.downloads.toLocaleString()} downloads`}>
                      <DownloadIcon />
                      {formatDownloads(r.downloads)}
                    </span>
                  }
                />
              ))}
            </section>
          ))}
          {hasMore && (
            <button
              type="button"
              onClick={() => {
                setLoadingMore(true);
                void run(query, page + 1);
              }}
              disabled={loadingMore}
              className="rounded-xl bg-white/10 px-3 py-2.5 text-sm font-medium text-white/80 transition-colors hover:bg-white/20 disabled:opacity-50"
            >
              {loadingMore ? "Loading…" : "Show more"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Release names are long dotted strings; the row title shows the first readable chunk and the
// full name sits underneath, since that full name is what tells two uploads apart.
function shortRelease(release: string): string {
  const cleaned = release.replace(/[._]+/g, " ").trim();
  return cleaned.length > 38 ? `${cleaned.slice(0, 36).trimEnd()}…` : cleaned;
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-white/40" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
