"use client";

import { useCallback, useEffect, useState } from "react";
import { quietButton } from "@/components/admin/Dialog";
import { deleteFeedback, listFeedback, markFeedback, type AdminFeedback } from "@/lib/admin";
import { timeAgo } from "@/lib/opinions";
import { showToast } from "@/lib/toast";

const KIND_LABEL = { problem: "Problem", idea: "Idea", other: "Other" } as const;
type Filter = "new" | "handled" | "all";

/** What people wrote from Settings, newest first. */
export default function FeedbackTab() {
  const [items, setItems] = useState<AdminFeedback[]>([]);
  const [total, setTotal] = useState(0);
  const [unhandled, setUnhandled] = useState(0);
  const [filter, setFilter] = useState<Filter>("new");
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);

  const load = useCallback(
    async (offset = 0) => {
      try {
        const page = await listFeedback(offset, filter === "all" ? undefined : filter === "handled");
        // "new" means not handled yet.
        setItems((cur) => (offset === 0 ? page.items : [...cur, ...page.items]));
        setTotal(page.total);
        setUnhandled(page.unhandled);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't load feedback.");
      }
    },
    [filter]
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  async function toggle(f: AdminFeedback) {
    try {
      await markFeedback(f.id, !f.handled);
      await load(0);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't change that.");
    }
  }

  async function remove(f: AdminFeedback) {
    if (armed !== f.id) {
      setArmed(f.id);
      return;
    }
    try {
      await deleteFeedback(f.id);
      setArmed(null);
      showToast("Deleted.", "success");
      await load(0);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't delete that.");
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-white">
          Feedback <span className="text-sm font-normal text-white/40">({unhandled} to read)</span>
        </h2>
        <div role="group" aria-label="Show" className="flex gap-1">
          {(["new", "handled", "all"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={`h-8 rounded-full px-3 text-sm ${filter === f ? "bg-accent/15 text-accent" : "text-white/60 hover:bg-white/5"}`}
            >
              {f === "new" ? "New" : f === "handled" ? "Handled" : "All"}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      {!error && items.length === 0 && <p className="text-sm text-white/50">Nothing here.</p>}
      <ul className="divide-y divide-white/10 rounded-2xl border border-white/10">
        {items.map((f) => (
          <li key={f.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-xs text-white/50">
                <span className="font-medium text-white/80">{f.author_name}</span>
                <span className="rounded bg-white/10 px-1.5 py-0.5">{KIND_LABEL[f.kind]}</span>
                {f.handled && <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-300">handled</span>}
                <span>{timeAgo(f.created_at)}</span>
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-white/85">{f.message}</p>
              {(f.page || f.device) && (
                <p className="mt-1 text-xs text-white/40">
                  {f.page ? `on ${f.page}` : ""}
                  {f.page && f.device ? " · " : ""}
                  {f.device ?? ""}
                </p>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <button type="button" className={quietButton} onClick={() => toggle(f)}>
                {f.handled ? "Reopen" : "Mark handled"}
              </button>
              <button type="button" className={`${quietButton} ${armed === f.id ? "!bg-red-500/80 !text-white" : ""}`} onClick={() => remove(f)} onBlur={() => setArmed(null)}>
                {armed === f.id ? "Really delete?" : "Delete"}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {items.length < total && (
        <button type="button" className={quietButton} onClick={() => load(items.length)}>
          Show more
        </button>
      )}
    </section>
  );
}
