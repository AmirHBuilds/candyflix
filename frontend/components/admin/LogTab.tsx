"use client";

import { useCallback, useState } from "react";
import Avatar from "@/components/Avatar";
import { MoreButton, PagedState, usePaged, when } from "@/components/admin/DrillViews";
import { boxNameFor } from "@/lib/box-name";
import { getAuditTrail, getSignInLog, type AuditEntry } from "@/lib/admin";

const PAGE = 50;

/** One plain sentence per logged action ("Candy looked at Bob's watch history"). */
export function describe(e: AuditEntry): string {
  const who = e.actor_name;
  const t = e.target_name ?? "someone";
  const q = `“${e.target_name ?? "a message"}”`;
  switch (e.action) {
    case "user.create":
      return `${who} added ${t}`;
    case "user.update":
      return `${who} edited ${t}`;
    case "user.disable":
      return `${who} disabled ${t}`;
    case "user.enable":
      return `${who} enabled ${t}`;
    case "user.make_admin":
      return `${who} made ${t} an admin`;
    case "user.remove_admin":
      return `${who} removed ${t} as an admin`;
    case "user.password_reset":
      return `${who} reset ${t}'s password`;
    case "user.2fa_off":
      return `${who} switched off two-step sign-in for ${t}`;
    case "user.delete":
      return `${who} deleted ${t}`;
    case "history.view":
      return `${who} looked at ${t}'s watch history`;
    case "ai.searches.view":
      return `${who} looked at ${t}'s AI searches`;
    case "watchlist.view":
      return `${who} looked at ${e.target_name ? boxNameFor(e.target_name) : "someone's box"}`;
    case "announcement.create":
      return `${who} sent the message ${q}`;
    case "announcement.update":
      return `${who} edited the message ${q}`;
    case "announcement.stop":
      return `${who} stopped showing the message ${q}`;
    case "announcement.resume":
      return `${who} showed the message ${q} again`;
    case "announcement.reshow":
      return `${who} asked everyone to read ${q} again`;
    case "announcement.delete":
      return `${who} deleted the message ${q}`;
    case "banners.update":
      return `${who} edited the home banners`;
    case "badge.update":
      return `${who} changed the admin badge${e.detail ? ` (${e.detail})` : ""}`;
    case "ai.config":
      return `${who} changed the Ask AI settings${e.detail ? ` (${e.detail})` : ""}`;
    case "ai.history":
      return `${who} turned ${e.detail === "On" ? "on" : "off"} watch history for Ask AI for ${q}`;
    case "footer.update":
      return `${who} edited the footer`;
    case "cache.tmdb_clear":
      return `${who} cleared the movie info cache`;
    case "cache.subtitle_clear":
      return `${who} cleared the subtitle cache`;
    default:
      return `${who}: ${e.action}${e.target_name ? ` (${e.target_name})` : ""}`;
  }
}

function AdminActions() {
  const fetchPage = useCallback((offset: number) => getAuditTrail(offset, PAGE), []);
  const { items, total, error, busy, more } = usePaged(fetchPage);
  return (
    <div className="space-y-4">
      <PagedState total={total} error={error} hasItems={items.length > 0} empty="Nothing has been logged yet." />
      {items.length > 0 && (
        <ul className="divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/[0.03]">
          {items.map((e) => (
            <li key={e.id} className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-4">
              <p className="min-w-0 flex-1 text-sm text-white/90">
                {describe(e)}
                {e.detail && <span className="text-white/40"> · {e.detail}</span>}
              </p>
              <time dateTime={e.at} className="shrink-0 text-xs text-white/40">
                {when(e.at)}
              </time>
            </li>
          ))}
        </ul>
      )}
      {total !== null && <MoreButton shown={items.length} total={total} busy={busy} onMore={() => more(items.length)} />}
    </div>
  );
}

function SignIns() {
  const fetchPage = useCallback((offset: number) => getSignInLog(offset, PAGE), []);
  const { items, total, error, busy, more } = usePaged(fetchPage);
  return (
    <div className="space-y-4">
      <PagedState total={total} error={error} hasItems={items.length > 0} empty="No sign-ins recorded yet. They are logged from now on." />
      {items.length > 0 && (
        <ul className="divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/[0.03]">
          {items.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-3">
              <Avatar name={s.display_name} src={s.avatar_url} size={32} />
              <p className="min-w-0 flex-1 truncate text-sm text-white/90">
                {s.display_name} <span className="text-white/40">· {s.device}</span>
              </p>
              <time dateTime={s.at} className="shrink-0 text-xs text-white/40">
                {when(s.at)}
              </time>
            </li>
          ))}
        </ul>
      )}
      {total !== null && <MoreButton shown={items.length} total={total} busy={busy} onMore={() => more(items.length)} />}
    </div>
  );
}

const VIEWS = [
  { id: "actions", label: "Admin actions" },
  { id: "signins", label: "Sign-ins" },
] as const;

export default function LogTab() {
  const [view, setView] = useState<(typeof VIEWS)[number]["id"]>("actions");
  return (
    <section aria-label="Log" className="space-y-4">
      <p className="text-sm text-white/50">
        {view === "actions"
          ? "What admins did, including looking at someone's history. Newest first."
          : "Every successful sign-in, with the device used. Newest first."}
      </p>
      <div role="tablist" aria-label="Log views" className="flex gap-2">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={view === v.id}
            onClick={() => setView(v.id)}
            className={`rounded-xl px-4 py-2 text-sm font-medium ${view === v.id ? "bg-accent/15 text-accent" : "text-white/60 hover:bg-white/5 hover:text-white"}`}
          >
            {v.label}
          </button>
        ))}
      </div>
      {view === "actions" ? <AdminActions /> : <SignIns />}
    </section>
  );
}
