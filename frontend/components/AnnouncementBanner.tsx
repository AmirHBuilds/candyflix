"use client";

import { useCallback, useEffect, useState } from "react";
import { acknowledgeAnnouncement, getPendingAnnouncements, type PendingAnnouncement } from "@/lib/announcements";

const REFRESH_MS = 60_000;

/**
 * Messages from the admin, at the very top of the site. Each stays until the
 * person presses "I understand" (saved on the server, so it's gone on every
 * device). New messages appear within a minute, or when they return to the tab.
 */
export default function AnnouncementBanner() {
  const [items, setItems] = useState<PendingAnnouncement[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getPendingAnnouncements()
      .then(setItems)
      .catch(() => {}); // a failed refresh keeps what is on screen
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  async function accept(id: string) {
    setBusy(id);
    setError(null);
    try {
      await acknowledgeAnnouncement(id);
      setItems((cur) => cur.filter((a) => a.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that.");
    } finally {
      setBusy(null);
    }
  }

  if (items.length === 0) return null;
  return (
    <section aria-label="Messages from the admin" className="border-b border-accent/30 bg-accent/10">
      <ul className="mx-auto flex max-w-5xl flex-col divide-y divide-white/10 px-6 sm:px-10">
        {items.map((a) => (
          <li key={a.id} role="alert" className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:gap-6">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white">{a.title}</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-white/80">{a.body}</p>
            </div>
            <button
              type="button"
              disabled={busy === a.id}
              onClick={() => accept(a.id)}
              className="shrink-0 self-start rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-60"
            >
              {busy === a.id ? "Saving…" : "I understand"}
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p className="px-6 pb-3 text-center text-sm text-red-300 sm:px-10">
          {error}
        </p>
      )}
    </section>
  );
}
