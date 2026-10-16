"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getNotices, markNoticesRead, setRest, type AdminNotices } from "@/lib/admin";
import { showToast } from "@/lib/toast";

const POLL_MS = 30000;
const CHANGED = "admin-notices-changed";

/**
 * What the admins are told while they are on the site. Polls every 30 seconds (not while the tab is hidden).
 * With `toast`, a notice that arrives after the page opened pops up once, unless this admin is resting.
 * Reading everything or changing rest mode is shared between every copy of the hook on the page.
 */
export function useAdminNotices({ toast = false }: { toast?: boolean } = {}) {
  const [data, setData] = useState<AdminNotices | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cursor = useRef<string | null>(null); // the newest notice already seen; only newer ones pop up

  const load = useCallback(async () => {
    try {
      const next = await getNotices();
      setData(next);
      setError(null);
      const newest = next.items[0]?.at ?? null;
      if (cursor.current === null) {
        cursor.current = newest ?? next.server_time; // the first look only sets the starting point
      } else if (toast && !next.resting) {
        const fresh = next.items.filter((n) => n.at > (cursor.current as string)).reverse();
        fresh.slice(0, 3).forEach((n) => showToast(n.title, "info", 9000));
        if (fresh.length > 3) showToast(`and ${fresh.length - 3} more. Open the bell to see them.`, "info", 9000);
      }
      if (newest && (cursor.current === null || newest > cursor.current)) cursor.current = newest;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the notices.");
    }
  }, [toast]);

  useEffect(() => {
    void load();
    const tick = () => {
      if (typeof document === "undefined" || !document.hidden) void load();
    };
    const timer = setInterval(tick, POLL_MS);
    const onChange = () => void load();
    window.addEventListener(CHANGED, onChange);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener(CHANGED, onChange);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [load]);

  const markRead = useCallback(async () => {
    try {
      await markNoticesRead();
      window.dispatchEvent(new Event(CHANGED));
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't mark them as read.");
    }
  }, []);

  const rest = useCallback(async (minutes: number | null) => {
    try {
      setData(await setRest(minutes));
      window.dispatchEvent(new Event(CHANGED));
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't change rest mode.");
    }
  }, []);

  return { data, error, markRead, rest, reload: load };
}

export function restLabel(d: Pick<AdminNotices, "resting" | "rest_forever" | "rest_until"> | null): string {
  if (!d?.resting) return "Notifications are on.";
  if (d.rest_forever) return "Resting until you switch notifications back on.";
  if (d.rest_until) {
    const t = new Date(d.rest_until);
    return `Resting until ${t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`;
  }
  return "Resting.";
}

export const REST_CHOICES: { label: string; minutes: number | null }[] = [
  { label: "1 hour", minutes: 60 },
  { label: "8 hours", minutes: 480 },
  { label: "Until I switch it on", minutes: null },
];
