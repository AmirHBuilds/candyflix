"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { REST_CHOICES, restLabel, useAdminNotices } from "@/components/admin/useAdminNotices";
import { quietButton } from "@/components/admin/Dialog";
import { timeAgo } from "@/lib/opinions";

/** For admins, in the header on every page: new feedback and accounts used from many places, with a rest mode. */
export default function NoticeBell() {
  const { data, markRead, rest } = useAdminNotices({ toast: true });
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!data) return null;
  const unread = data.unread;
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label={unread > 0 && !data.resting ? `Notifications, ${unread} new` : data.resting ? "Notifications, resting" : "Notifications"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-10 w-10 items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white"
      >
        {data.resting ? (
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.7 21a2 2 0 0 1-3.4 0" />
          </svg>
        )}
        {unread > 0 && !data.resting && (
          <span aria-hidden="true" className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label="Notifications" className="animate-fade-up fixed right-3 top-16 z-40 w-[min(22rem,calc(100vw-1.5rem))] rounded-2xl border border-white/10 bg-surface p-3 shadow-2xl sm:absolute sm:right-0 sm:top-full sm:mt-2">
          <div className="flex items-center justify-between gap-2 px-1 pb-2">
            <p className="text-sm font-semibold text-white">Notifications</p>
            {unread > 0 && (
              <button type="button" className="text-xs text-accent hover:underline" onClick={markRead}>
                Mark all read
              </button>
            )}
          </div>
          {data.items.length === 0 ? (
            <p className="px-1 py-3 text-sm text-white/50">Nothing yet.</p>
          ) : (
            <ul className="max-h-80 divide-y divide-white/10 overflow-y-auto">
              {data.items.map((n) => (
                <li key={n.id}>
                  <Link href={`/admin?tab=${n.link ?? "overview"}`} onClick={() => setOpen(false)} className="block px-1 py-2.5 hover:bg-white/5">
                    <p className="flex items-center gap-2 text-sm text-white/90">
                      {n.unread && <span aria-label="new" className="h-2 w-2 shrink-0 rounded-full bg-accent" />}
                      <span className="min-w-0 flex-1 truncate">{n.title}</span>
                    </p>
                    {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-white/50">{n.body}</p>}
                    <p className="mt-0.5 text-xs text-white/30">{timeAgo(n.at)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 border-t border-white/10 pt-3">
            <p className="px-1 text-xs text-white/50">{restLabel(data)}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {data.resting ? (
                <button type="button" className={quietButton} onClick={() => rest(0)}>
                  Switch notifications on
                </button>
              ) : (
                REST_CHOICES.map((c) => (
                  <button key={c.label} type="button" className={quietButton} onClick={() => rest(c.minutes)}>
                    Rest: {c.label}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
