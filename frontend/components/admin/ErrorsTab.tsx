"use client";

import { useCallback, useEffect, useState } from "react";
import { quietButton } from "@/components/admin/Dialog";
import { clearHandledErrors, deleteError, handleAllErrors, listErrors, markError, type AdminError, type AdminErrorPage } from "@/lib/admin";
import { timeAgo } from "@/lib/opinions";
import { showToast } from "@/lib/toast";

type Filter = "new" | "handled" | "all";

export const SOURCE_LABEL: Record<string, string> = {
  server: "Server",
  ai: "AI",
  resolver: "Video service",
  sync: "Subtitle sync",
  subtitles: "Subtitles",
  tmdb: "TMDB",
  browser: "Browser",
  system: "System",
};

const chip = (on: boolean) => `h-8 rounded-full px-3 text-sm ${on ? "bg-accent/15 text-accent" : "text-white/60 hover:bg-white/5"}`;

/** Everything that went wrong, newest first: server errors, AI, the video service, subtitle sync, and what browsers reported. */
export default function ErrorsTab() {
  const [items, setItems] = useState<AdminError[]>([]);
  const [meta, setMeta] = useState<Pick<AdminErrorPage, "total" | "unhandled" | "last_24h" | "by_source">>({ total: 0, unhandled: 0, last_24h: 0, by_source: {} });
  const [filter, setFilter] = useState<Filter>("new");
  const [source, setSource] = useState<string>("");
  const [level, setLevel] = useState<string>("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);

  const load = useCallback(
    async (offset = 0) => {
      try {
        const page = await listErrors({ offset, source: source || undefined, level: level || undefined, handled: filter === "all" ? undefined : filter === "handled", q: query || undefined });
        setItems((cur) => (offset === 0 ? page.items : [...cur, ...page.items]));
        setMeta({ total: page.total, unhandled: page.unhandled, last_24h: page.last_24h, by_source: page.by_source });
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't load the error log.");
      }
    },
    [filter, source, level, query]
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  async function toggle(e: AdminError) {
    try {
      await markError(e.id, !e.handled);
      await load(0);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't change that.");
    }
  }

  async function remove(e: AdminError) {
    if (armed !== e.id) {
      setArmed(e.id);
      return;
    }
    try {
      await deleteError(e.id);
      setArmed(null);
      await load(0);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't delete that.");
    }
  }

  async function bulk(kind: "handle" | "clear") {
    try {
      if (kind === "handle") {
        const { changed } = await handleAllErrors(source || undefined);
        showToast(`${changed} marked as handled.`, "success");
      } else {
        const { cleared } = await clearHandledErrors();
        showToast(`${cleared} removed.`, "success");
      }
      await load(0);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't do that.");
    }
  }

  const sources = Object.keys(SOURCE_LABEL);

  return (
    <section aria-label="Errors" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-white">
          Errors{" "}
          <span className="text-sm font-normal text-white/40">
            ({meta.unhandled} open · {meta.last_24h} in the last 24 hours)
          </span>
        </h2>
        <div role="group" aria-label="Show" className="flex gap-1">
          {(["new", "handled", "all"] as Filter[]).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={chip(filter === f)}>
              {f === "new" ? "Open" : f === "handled" ? "Handled" : "All"}
            </button>
          ))}
        </div>
      </div>

      <div role="group" aria-label="Where from" className="flex flex-wrap gap-1">
        <button type="button" aria-pressed={source === ""} onClick={() => setSource("")} className={chip(source === "")}>
          Everything
        </button>
        {sources.map((s) => (
          <button key={s} type="button" aria-pressed={source === s} onClick={() => setSource(source === s ? "" : s)} className={chip(source === s)}>
            {SOURCE_LABEL[s]}
            {meta.by_source[s] ? <span className="ml-1.5 rounded-full bg-red-500/80 px-1.5 text-[11px] text-white">{meta.by_source[s]}</span> : null}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(search.trim());
          }}
        >
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search the log"
            aria-label="Search the log"
            className="h-9 w-56 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/30 focus:border-accent/60 focus:outline-none"
          />
          <button type="submit" className={quietButton}>
            Search
          </button>
        </form>
        <button type="button" aria-pressed={level === "error"} onClick={() => setLevel(level === "error" ? "" : "error")} className={chip(level === "error")}>
          Errors only
        </button>
        <span className="flex-1" />
        <button type="button" className={quietButton} onClick={() => bulk("handle")}>
          Mark all handled
        </button>
        <button type="button" className={quietButton} onClick={() => bulk("clear")}>
          Remove handled
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      {!error && items.length === 0 && <p className="text-sm text-white/50">Nothing here. That is good news.</p>}

      <ul className="divide-y divide-white/10 rounded-2xl border border-white/10">
        {items.map((e) => {
          const expanded = open === e.id;
          return (
            <li key={e.id} className="px-4 py-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-xs text-white/50">
                    <span className={`rounded px-1.5 py-0.5 ${e.level === "error" ? "bg-red-500/15 text-red-300" : "bg-amber-500/15 text-amber-200"}`}>{e.level}</span>
                    <span className="rounded bg-white/10 px-1.5 py-0.5">{SOURCE_LABEL[e.source] ?? e.source}</span>
                    {e.count > 1 && <span className="rounded bg-white/10 px-1.5 py-0.5">×{e.count}</span>}
                    {e.handled && <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-300">handled</span>}
                    <span>{timeAgo(e.last_seen)}</span>
                    {e.user_name && <span>· {e.user_name}</span>}
                  </p>
                  <p className="mt-1 break-words text-sm font-medium text-white/90">{e.title}</p>
                  {e.where && <p className="mt-0.5 break-all text-xs text-white/40">{e.where}</p>}
                  {expanded && e.detail && <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/40 p-3 text-xs text-white/70">{e.detail}</pre>}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {e.detail && (
                    <button type="button" className={quietButton} aria-expanded={expanded} onClick={() => setOpen(expanded ? null : e.id)}>
                      {expanded ? "Hide details" : "Details"}
                    </button>
                  )}
                  <button type="button" className={quietButton} onClick={() => toggle(e)}>
                    {e.handled ? "Reopen" : "Mark handled"}
                  </button>
                  <button type="button" className={`${quietButton} ${armed === e.id ? "!bg-red-500/80 !text-white" : ""}`} onClick={() => remove(e)} onBlur={() => setArmed(null)}>
                    {armed === e.id ? "Really delete?" : "Delete"}
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {items.length < meta.total && (
        <button type="button" className={quietButton} onClick={() => load(items.length)}>
          Show more
        </button>
      )}
    </section>
  );
}
