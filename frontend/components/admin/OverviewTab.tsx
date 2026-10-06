"use client";

import { useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import NowWatchingCard from "@/components/admin/NowWatchingCard";
import { getAdminStats, type AdminStats } from "@/lib/admin";

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
      <p className="text-2xl font-semibold text-white">{value}</p>
      <p className="mt-0.5 text-xs text-white/50">{label}</p>
    </div>
  );
}

export default function OverviewTab() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAdminStats()
      .then(setStats)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load the dashboard."));
  }, []);

  if (error) {
    return (
      <p role="alert" className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-200">
        {error}
      </p>
    );
  }
  if (!stats) return <p className="text-sm text-white/50">Loading dashboard…</p>;

  const peak = Math.max(1, ...stats.activity.map((d) => d.saves));

  return (
    <section aria-label="Overview" className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="People" value={stats.users_total} />
        <Stat label="Admins" value={stats.admins} />
        <Stat label="Disabled" value={stats.disabled} />
        <Stat label="Active, last 7 days" value={stats.active_last_7_days} />
        <Stat label="Marked watched" value={stats.watched_items} />
      </div>

      <NowWatchingCard />

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <h2 className="text-sm font-semibold text-white">Watching, last 14 days</h2>
        <p className="mb-4 text-xs text-white/40">Progress saves per day — a rough measure of how much is being watched.</p>
        <ol className="flex h-28 items-end gap-1" aria-label="Activity per day">
          {stats.activity.map((day) => (
            <li key={day.date} className="flex h-full flex-1 flex-col justify-end" title={`${day.date}: ${day.saves} saves, ${day.active_users} people`}>
              <div
                className="w-full rounded-t bg-accent/70"
                style={{ height: `${Math.max(day.saves > 0 ? 6 : 2, (day.saves / peak) * 100)}%`, opacity: day.saves > 0 ? 1 : 0.25 }}
              />
              <span className="sr-only">
                {day.date}: {day.saves} saves
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="mb-3 text-sm font-semibold text-white">Most watched</h2>
          {stats.top_titles.length === 0 ? (
            <p className="text-sm text-white/40">Nothing watched yet.</p>
          ) : (
            <ol className="space-y-2">
              {stats.top_titles.map((t, i) => (
                <li key={`${t.media_type}-${t.tmdb_id}`} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate text-white/80">
                    <span className="mr-2 text-white/30">{i + 1}.</span>
                    {t.title ?? `${t.media_type} #${t.tmdb_id}`}
                  </span>
                  <span className="shrink-0 text-xs text-white/40">
                    {t.viewers} {t.viewers === 1 ? "viewer" : "viewers"}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="mb-3 text-sm font-semibold text-white">Recent sign-ins</h2>
          {stats.recent_logins.length === 0 ? (
            <p className="text-sm text-white/40">No sign-ins recorded yet.</p>
          ) : (
            <ul className="space-y-2">
              {stats.recent_logins.map((l) => (
                <li key={l.id} className="flex items-center gap-3 text-sm">
                  <Avatar name={l.display_name} src={l.avatar_url} size={28} />
                  <span className="min-w-0 flex-1 truncate text-white/80">{l.display_name}</span>
                  <time dateTime={l.last_login_at} className="shrink-0 text-xs text-white/40">
                    {new Date(l.last_login_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
