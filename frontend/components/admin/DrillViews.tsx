"use client";

import { useCallback, useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import { formatClock, whatLabel } from "@/components/admin/NowWatchingCard";
import { quietButton } from "@/components/admin/Dialog";
import {
  getDayActivity,
  getSignIns,
  getTitleViewers,
  getTitlesWatched,
  type LoginRow,
  type TitleRow,
  type ViewerItem,
} from "@/lib/admin";
import { posterUrl } from "@/lib/media";

const PAGE = 50;

export function when(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function progressText(h: { opened_only: boolean; fraction: number | null; position_seconds: number; duration_seconds: number }): string {
  if (h.opened_only) return "Opened, not started";
  if (h.fraction != null && h.fraction >= 0.9) return "Finished";
  return `${formatClock(h.position_seconds)} of ${formatClock(h.duration_seconds)}`;
}

function Poster({ path }: { path: string | null }) {
  const src = posterUrl(path);
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className="h-14 w-10 shrink-0 rounded object-cover" loading="lazy" />
  ) : (
    <div className="h-14 w-10 shrink-0 rounded bg-white/10" aria-hidden="true" />
  );
}

export function DrillHeader({ title, subtitle, onBack, backLabel }: { title: string; subtitle?: string; onBack: () => void; backLabel: string }) {
  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} className={quietButton}>
        ← {backLabel}
      </button>
      <div>
        <h2 className="text-xl font-semibold text-white">{title}</h2>
        {subtitle && <p className="text-sm text-white/50">{subtitle}</p>}
      </div>
    </div>
  );
}

/** Loads a paged list ("Load more") and shows loading / empty / error states. */
function usePaged<T>(fetchPage: (offset: number) => Promise<{ items: T[]; total: number }>) {
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const more = useCallback(
    async (offset: number) => {
      setBusy(true);
      try {
        const page = await fetchPage(offset);
        setItems((cur) => (offset === 0 ? page.items : [...cur, ...page.items]));
        setTotal(page.total);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load that.");
      } finally {
        setBusy(false);
      }
    },
    [fetchPage],
  );
  useEffect(() => {
    more(0);
  }, [more]);
  return { items, total, error, busy, more };
}

function MoreButton({ shown, total, busy, onMore }: { shown: number; total: number; busy: boolean; onMore: () => void }) {
  if (shown >= total) return null;
  return (
    <button type="button" disabled={busy} onClick={onMore} className={quietButton}>
      {busy ? "Loading…" : `Load more (${total - shown} left)`}
    </button>
  );
}

function PagedState({ total, error, hasItems, empty }: { total: number | null; error: string | null; hasItems: boolean; empty: string }) {
  if (error) return <p role="alert" className="text-sm text-red-300">{error}</p>;
  if (total === null) return <p className="text-sm text-white/50">Loading…</p>;
  if (total === 0 && !hasItems) return <p className="text-sm text-white/40">{empty}</p>;
  return null;
}

// ---- Titles (Overview: "Marked watched", "Most watched") ----

export function TitlesView({ onBack, onOpen }: { onBack: () => void; onOpen: (t: TitleRow) => void }) {
  const fetchPage = useCallback((offset: number) => getTitlesWatched(offset, PAGE), []);
  const { items, total, error, busy, more } = usePaged(fetchPage);
  return (
    <section aria-label="Titles watched" className="space-y-4">
      <DrillHeader title="Everything watched" subtitle="Most-watched first. Open a title to see who watched it." onBack={onBack} backLabel="Overview" />
      <PagedState total={total} error={error} hasItems={items.length > 0} empty="Nothing watched yet." />
      {items.length > 0 && (
        <ul className="divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/[0.03]">
          {items.map((t) => (
            <li key={`${t.media_type}-${t.tmdb_id}`}>
              <button type="button" onClick={() => onOpen(t)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/5">
                <Poster path={t.poster_path} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-white/90">{t.title ?? `${t.media_type === "tv" ? "Show" : "Movie"} #${t.tmdb_id}`}</span>
                  <span className="block text-xs text-white/40">
                    {t.media_type === "tv" ? "TV show" : "Movie"} · last watched {when(t.last_watched_at)}
                    {t.media_type === "tv" && ` · ${t.entries} ${t.entries === 1 ? "episode" : "episodes"} saved`}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-white/50">
                  {t.viewers} {t.viewers === 1 ? "viewer" : "viewers"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {total !== null && <MoreButton shown={items.length} total={total} busy={busy} onMore={() => more(items.length)} />}
    </section>
  );
}

// ---- Viewer rows (who watched a title / what happened on a day) ----

function ViewerList({ items, showTitle, onPerson }: { items: ViewerItem[]; showTitle: boolean; onPerson: (id: string) => void }) {
  return (
    <ul className="divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/[0.03]">
      {items.map((v) => (
        <li key={`${v.user_id}-${v.media_type}-${v.tmdb_id}-${v.season_number ?? "m"}-${v.episode_number ?? "m"}`}>
          <button type="button" onClick={() => onPerson(v.user_id)} aria-label={`Open ${v.display_name}`} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/5">
            <Avatar name={v.display_name} src={v.avatar_url} size={36} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-white/90">
                <span className="font-medium">{v.display_name}</span>
                {showTitle ? <span className="text-white/60"> · {whatLabel(v)}</span> : v.media_type === "tv" && v.season_number != null ? <span className="text-white/60"> · S{v.season_number}E{v.episode_number}</span> : null}
              </span>
              <span className="block text-xs text-white/40">
                {progressText(v)} · {when(v.updated_at)}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function TitleViewersView({
  mediaType,
  tmdbId,
  name,
  onBack,
  backLabel,
  onPerson,
}: {
  mediaType: "movie" | "tv";
  tmdbId: number;
  name: string;
  onBack: () => void;
  backLabel: string;
  onPerson: (id: string) => void;
}) {
  const fetchPage = useCallback((offset: number) => getTitleViewers(mediaType, tmdbId, offset, PAGE), [mediaType, tmdbId]);
  const { items, total, error, busy, more } = usePaged(fetchPage);
  return (
    <section aria-label="Who watched" className="space-y-4">
      <DrillHeader title={name} subtitle="Who has watched this, and how far they got." onBack={onBack} backLabel={backLabel} />
      <PagedState total={total} error={error} hasItems={items.length > 0} empty="Nobody has watched this." />
      {items.length > 0 && <ViewerList items={items} showTitle={false} onPerson={onPerson} />}
      {total !== null && <MoreButton shown={items.length} total={total} busy={busy} onMore={() => more(items.length)} />}
    </section>
  );
}

export function DayView({ day, onBack, onPerson }: { day: string; onBack: () => void; onPerson: (id: string) => void }) {
  const fetchPage = useCallback((offset: number) => getDayActivity(day, offset, PAGE), [day]);
  const { items, total, error, busy, more } = usePaged(fetchPage);
  const label = new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  return (
    <section aria-label="Day activity" className="space-y-4">
      <DrillHeader title={label} subtitle="Everything saved that day (UTC), latest first." onBack={onBack} backLabel="Overview" />
      <PagedState total={total} error={error} hasItems={items.length > 0} empty="Nothing was watched that day." />
      {items.length > 0 && <ViewerList items={items} showTitle onPerson={onPerson} />}
      {total !== null && <MoreButton shown={items.length} total={total} busy={busy} onMore={() => more(items.length)} />}
    </section>
  );
}

// ---- Sign-ins ----

export function SignInsView({ onBack, onPerson }: { onBack: () => void; onPerson: (id: string) => void }) {
  const [rows, setRows] = useState<LoginRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getSignIns()
      .then(setRows)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load the sign-ins."));
  }, []);
  return (
    <section aria-label="Sign-ins" className="space-y-4">
      <DrillHeader title="Sign-ins" subtitle="Everyone, most recent sign-in first, and how many devices are signed in now." onBack={onBack} backLabel="Overview" />
      {error ? (
        <p role="alert" className="text-sm text-red-300">{error}</p>
      ) : !rows ? (
        <p className="text-sm text-white/50">Loading…</p>
      ) : (
        <ul className="divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/[0.03]">
          {rows.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => onPerson(r.id)} aria-label={`Open ${r.display_name}`} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/5">
                <Avatar name={r.display_name} src={r.avatar_url} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-white/90">
                    {r.display_name}
                    {r.is_disabled && <span className="ml-2 rounded bg-red-500/15 px-1.5 py-0.5 text-xs text-red-300">Disabled</span>}
                  </span>
                  <span className="block text-xs text-white/40">@{r.username} · last sign-in {when(r.last_login_at)}</span>
                </span>
                <span className="shrink-0 text-xs text-white/50">
                  {r.active_sessions} {r.active_sessions === 1 ? "device" : "devices"} now
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
