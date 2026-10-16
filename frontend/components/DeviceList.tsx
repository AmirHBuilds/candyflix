"use client";

import { placeName } from "@/lib/country";
import { timeAgo } from "@/lib/opinions";

export type DeviceItem = {
  id: string;
  label: string;
  user_agent: string | null;
  ip: string | null;
  country: string | null;
  first_seen: string;
  last_seen: string;
  last_login_at: string;
  sign_ins: number;
  active: boolean;
  sessions: number;
  current: boolean;
};
export type DevicesOverview = { items: DeviceItem[]; active: number; today: number; limits_on: boolean; max_per_day: number; max_active: number };

const smallButton =
  "h-9 shrink-0 rounded-xl bg-white/10 px-3 text-sm font-medium text-white/80 transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40";

/** A person's devices: what, where (address and country), when last seen, and whether it is signed in now. Shared by Settings and the admin's person view. */
export default function DeviceList({
  data,
  busy = false,
  onEnd,
  empty = "Nothing to show yet. Devices that sign in from now on are listed here.",
}: {
  data: DevicesOverview;
  busy?: boolean;
  onEnd: (d: DeviceItem) => void;
  empty?: string;
}) {
  return (
    <div className="space-y-3">
      {data.limits_on && data.items.length > 0 && (
        <p className="text-xs text-white/50">
          Signed in on {data.active} of {data.max_active} allowed devices · {data.today} of {data.max_per_day} different devices today
        </p>
      )}
      {data.items.length === 0 && <p className="text-sm text-white/50">{empty}</p>}
      {data.items.length > 0 && (
        <ul className="divide-y divide-white/10 rounded-xl border border-white/10">
          {data.items.map((d) => {
            const place = placeName(d.country);
            return (
              <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm text-white/90">
                    {d.label}
                    {d.current && <span className="ml-2 rounded bg-accent/20 px-1.5 py-0.5 text-xs text-accent">This device</span>}
                    <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${d.active ? "bg-emerald-500/15 text-emerald-300" : "bg-white/10 text-white/50"}`}>
                      {d.active ? "Signed in" : "Signed out"}
                    </span>
                  </p>
                  <p className="truncate text-xs text-white/50">
                    <span className="font-mono">{d.ip ?? "unknown address"}</span>
                    {place ? ` · ${place}` : ""}
                  </p>
                  <p className="truncate text-xs text-white/40">
                    {d.current ? "Using it now" : `Last seen ${timeAgo(d.last_seen)}`} · first seen {new Date(d.first_seen).toLocaleDateString()} · {d.sign_ins} {d.sign_ins === 1 ? "sign-in" : "sign-ins"}
                  </p>
                </div>
                {d.active && !d.current && (
                  <button type="button" disabled={busy} className={smallButton} aria-label={`Sign out ${d.label}`} onClick={() => onEnd(d)}>
                    Sign out
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
