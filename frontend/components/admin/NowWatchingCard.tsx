"use client";

import { useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import { getNowWatching, type NowWatching } from "@/lib/admin";

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

export function whatLabel(w: { title: string | null; media_type: string; tmdb_id: number; season_number: number | null; episode_number: number | null }): string {
  const name = w.title ?? `${w.media_type === "tv" ? "Show" : "Movie"} #${w.tmdb_id}`;
  if (w.media_type === "tv" && w.season_number != null && w.episode_number != null) {
    return `${name} · S${w.season_number}E${w.episode_number}`;
  }
  return name;
}

export function NowWatchingRow({ w, showPerson = true }: { w: NowWatching; showPerson?: boolean }) {
  const pct = w.duration_seconds > 0 ? Math.min(100, (w.position_seconds / w.duration_seconds) * 100) : 0;
  return (
    <li className="flex items-center gap-3 text-sm">
      {showPerson && <Avatar name={w.display_name} src={w.avatar_url} size={32} />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-white/90">
          {showPerson && <span className="font-medium">{w.display_name}</span>}
          {showPerson && <span className="text-white/40"> is </span>}
          <span>{w.playing ? "watching" : "paused on"} </span>
          <span className="text-white">{whatLabel(w)}</span>
        </p>
        <div className="mt-1.5 h-1 overflow-hidden rounded bg-white/10" aria-hidden="true">
          <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <span className="shrink-0 text-xs tabular-nums text-white/40">
        {formatClock(w.position_seconds)} / {formatClock(w.duration_seconds)}
      </span>
    </li>
  );
}

export default function NowWatchingCard({ intervalMs = 10_000 }: { intervalMs?: number }) {
  const [rows, setRows] = useState<NowWatching[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      getNowWatching()
        .then((r) => {
          if (!alive) return;
          setRows(r);
          setFailed(false);
        })
        .catch(() => alive && setFailed(true));
    load();
    const t = setInterval(load, intervalMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [intervalMs]);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Watching now</h2>
        <span className="text-xs text-white/40">{rows ? `${rows.length} ${rows.length === 1 ? "person" : "people"}` : ""}</span>
      </div>
      {failed && !rows ? (
        <p className="text-sm text-white/40">Couldn&apos;t load who is watching.</p>
      ) : !rows ? (
        <p className="text-sm text-white/40">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-white/40">Nobody is watching right now.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((w) => (
            <NowWatchingRow key={w.user_id} w={w} />
          ))}
        </ul>
      )}
    </div>
  );
}
