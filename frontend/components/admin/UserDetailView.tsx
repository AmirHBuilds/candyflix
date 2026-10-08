"use client";

import { useCallback, useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import { NowWatchingRow, formatClock, whatLabel } from "@/components/admin/NowWatchingCard";
import { fieldClass, primaryButton, quietButton } from "@/components/admin/Dialog";
import {
  getUserDetail,
  getUserHistory,
  getUserWatchlist,
  setUserAIHistory,
  updateAdminUser,
  type AdminUser,
  type HistoryItem,
  type UserDetail,
  type WatchlistEntry,
} from "@/lib/admin";
import { boxNameFor } from "@/lib/box-name";
import { posterUrl } from "@/lib/media";
import { showToast } from "@/lib/toast";

const PAGE = 50;

function when(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function Poster({ path, alt }: { path: string | null; alt: string }) {
  const src = posterUrl(path);
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className="h-14 w-10 shrink-0 rounded object-cover" loading="lazy" />
  ) : (
    <div className="h-14 w-10 shrink-0 rounded bg-white/10" aria-hidden="true" />
  );
}

function History({ userId }: { userId: string }) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const more = useCallback(
    async (offset: number) => {
      setBusy(true);
      try {
        const page = await getUserHistory(userId, offset, PAGE);
        setItems((cur) => (offset === 0 ? page.items : [...cur, ...page.items]));
        setTotal(page.total);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load the watch history.");
      } finally {
        setBusy(false);
      }
    },
    [userId],
  );

  useEffect(() => {
    more(0);
  }, [more]);

  if (error && items.length === 0) return <p role="alert" className="text-sm text-red-300">{error}</p>;
  if (total === null) return <p className="text-sm text-white/50">Loading history…</p>;
  if (total === 0) return <p className="text-sm text-white/40">No watch history yet.</p>;

  return (
    <div className="space-y-3">
      <p className="text-xs text-white/40">
        {total} {total === 1 ? "title or episode" : "titles and episodes"}, latest first. Shows where they stopped, not every play.
      </p>
      <ul className="divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/[0.03]">
        {items.map((h) => (
          <li key={`${h.media_type}-${h.tmdb_id}-${h.season_number ?? "m"}-${h.episode_number ?? "m"}`} className="flex items-center gap-3 px-4 py-3">
            <Poster path={h.poster_path} alt="" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-white/90">{whatLabel(h)}</p>
              <p className="text-xs text-white/40">
                {h.opened_only
                  ? "Opened, not started"
                  : h.fraction != null && h.fraction >= 0.9
                    ? "Finished"
                    : `${formatClock(h.position_seconds)} of ${formatClock(h.duration_seconds)}`}{" "}
                · {when(h.updated_at)}
              </p>
            </div>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {items.length < total && (
        <button type="button" disabled={busy} onClick={() => more(items.length)} className={quietButton}>
          {busy ? "Loading…" : `Load more (${total - items.length} left)`}
        </button>
      )}
    </div>
  );
}

function Box({ userId, name }: { userId: string; name: string }) {
  const [items, setItems] = useState<WatchlistEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getUserWatchlist(userId)
      .then(setItems)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load their list."));
  }, [userId]);
  if (error) return <p role="alert" className="text-sm text-red-300">{error}</p>;
  if (!items) return <p className="text-sm text-white/50">Loading…</p>;
  if (items.length === 0) return <p className="text-sm text-white/40">{name}&apos;s list is empty.</p>;
  return (
    <ul className="divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/[0.03]">
      {items.map((w) => (
        <li key={`${w.media_type}-${w.tmdb_id}`} className="flex items-center gap-3 px-4 py-3">
          <Poster path={w.poster_path} alt="" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-white/90">{w.title ?? `${w.media_type === "tv" ? "Show" : "Movie"} #${w.tmdb_id}`}</p>
            <p className="text-xs text-white/40">
              {w.media_type === "tv" ? "TV show" : "Movie"} · added {when(w.added_at)}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function AiLimitCard({ user, onSaved }: { user: AdminUser; onSaved: (user: AdminUser) => void }) {
  const [value, setValue] = useState(user.ai_daily_limit == null ? "" : String(user.ai_daily_limit));
  const [saving, setSaving] = useState(false);
  useEffect(() => setValue(user.ai_daily_limit == null ? "" : String(user.ai_daily_limit)), [user.ai_daily_limit]);

  async function save(next: number | null) {
    setSaving(true);
    try {
      onSaved(await updateAdminUser(user.id, { ai_daily_limit: next }));
      showToast(next === null ? "Back to the usual number of AI searches." : `Saved: ${next} AI ${next === 1 ? "search" : "searches"} a day.`, "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't save that.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <h3 className="mb-1 text-sm font-semibold text-white">AI searches a day</h3>
      <label className="mb-4 flex items-start gap-2 text-sm text-white/70">
        <input
          type="checkbox"
          aria-label="Use watch history for AI"
          checked={user.ai_use_history}
          disabled={saving}
          onChange={async (e) => {
            setSaving(true);
            try {
              onSaved(await setUserAIHistory(user.id, e.target.checked));
              showToast(e.target.checked ? "Ask AI may use their watch history again." : "Ask AI won't use their watch history.", "success");
            } catch (err) {
              showToast(err instanceof Error ? err.message : "Couldn't save that.");
            } finally {
              setSaving(false);
            }
          }}
          className="mt-0.5 h-4 w-4 accent-accent"
        />
        <span>
          Use their watch history and box for better picks
          <span className="block text-xs text-white/40">Same switch they have in Settings. Only titles and years are sent, never their name.</span>
        </span>
      </label>
      {user.is_admin ? (
        <p className="text-sm text-white/50">Admins have no limit.</p>
      ) : (
        <>
          <p className="mb-3 text-sm text-white/50">
            {user.ai_daily_limit == null ? "Using the usual number for everyone." : user.ai_daily_limit === 0 ? "Ask AI is switched off for this person." : `This person gets ${user.ai_daily_limit} a day.`}
          </p>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(value);
              if (value.trim() === "" || !Number.isInteger(n) || n < 0 || n > 1000) return showToast("Enter a whole number from 0 to 1000.");
              void save(n);
            }}
          >
            <input aria-label="AI searches a day" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Usual" className={`${fieldClass} w-28`} />
            <button type="submit" disabled={saving} className={primaryButton}>
              Save
            </button>
            <button type="button" disabled={saving || user.ai_daily_limit == null} onClick={() => void save(null)} className={quietButton}>
              Use the usual
            </button>
            <button type="button" disabled={saving || user.ai_daily_limit === 0} onClick={() => void save(0)} className={quietButton}>
              Switch off
            </button>
          </form>
        </>
      )}
    </div>
  );
}

const SECTION_IDS = ["history", "box"] as const;

// The second tab is that person's own box ("Eve Box"), not the viewer's.
const sectionsFor = (displayName: string) => [
  { id: "history" as const, label: "Watch history" },
  { id: "box" as const, label: boxNameFor(displayName) },
];

export default function UserDetailView({ userId, onBack, backLabel = "All people" }: { userId: string; onBack: () => void; backLabel?: string }) {
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<(typeof SECTION_IDS)[number]>("history");

  useEffect(() => {
    let alive = true;
    const load = () =>
      getUserDetail(userId)
        .then((d) => alive && (setDetail(d), setError(null)))
        .catch((err) => alive && setError(err instanceof Error ? err.message : "Couldn't load that person."));
    load();
    const t = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [userId]);

  return (
    <section aria-label="Person" className="space-y-5">
      <button type="button" onClick={onBack} className={quietButton}>
        ← {backLabel}
      </button>
      {error && !detail ? (
        <p role="alert" className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-200">{error}</p>
      ) : !detail ? (
        <p className="text-sm text-white/50">Loading…</p>
      ) : (
        <>
          <div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <Avatar name={detail.user.display_name} src={detail.user.avatar_url} size={64} />
            <div className="min-w-0">
              <h2 className="flex flex-wrap items-center gap-2 text-xl font-semibold text-white">
                <span className="truncate">{detail.user.display_name}</span>
                {detail.user.is_admin && <span className="rounded bg-accent/15 px-1.5 py-0.5 text-xs text-accent">Admin</span>}
                {detail.user.is_disabled && <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-xs text-red-300">Disabled</span>}
              </h2>
              <p className="text-sm text-white/50">@{detail.user.username}</p>
              <p className="mt-1 text-xs text-white/40">
                Last sign-in {when(detail.user.last_login_at)} · last activity {when(detail.last_activity)} · {detail.active_sessions}{" "}
                {detail.active_sessions === 1 ? "active sign-in" : "active sign-ins"} · {detail.user.watched_count} watched
              </p>
            </div>
          </div>

          <AiLimitCard user={detail.user} onSaved={(user) => setDetail({ ...detail, user })} />

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <h3 className="mb-3 text-sm font-semibold text-white">Watching now</h3>
            {detail.now_watching ? (
              <ul>
                <NowWatchingRow w={detail.now_watching} showPerson={false} />
              </ul>
            ) : (
              <p className="text-sm text-white/40">Not watching anything right now.</p>
            )}
          </div>

          <div role="tablist" aria-label="Person sections" className="flex gap-2">
            {sectionsFor(detail.user.display_name).map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={section === s.id}
                onClick={() => setSection(s.id)}
                className={`rounded-xl px-4 py-2 text-sm font-medium ${section === s.id ? "bg-accent/15 text-accent" : "text-white/60 hover:bg-white/5 hover:text-white"}`}
              >
                {s.label}
              </button>
            ))}
          </div>
          {section === "history" ? <History userId={userId} /> : <Box userId={userId} name={detail.user.display_name} />}
        </>
      )}
    </section>
  );
}
