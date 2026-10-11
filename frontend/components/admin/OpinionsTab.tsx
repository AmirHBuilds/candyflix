"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { quietButton } from "@/components/admin/Dialog";
import { Toggle } from "@/components/settings/controls";
import {
  deleteAdminOpinion,
  getSocialConfig,
  hideAdminOpinion,
  listAdminOpinions,
  saveSocialConfig,
  type AdminOpinion,
  type SocialConfig,
} from "@/lib/admin";
import { timeAgo } from "@/lib/opinions";
import { showToast } from "@/lib/toast";

const SWITCHES: { key: keyof SocialConfig; label: string; hint: string }[] = [
  { key: "enabled", label: "Opinions and likes", hint: "Off: nobody sees or writes opinions or hearts." },
  { key: "allow_anonymous", label: "Anonymous posting", hint: "You can still see who wrote an anonymous opinion here." },
  { key: "allow_replies", label: "Replies", hint: "Replies never notify anyone." },
  { key: "home_section", label: "“From the family” on Home", hint: "The calm card under the home banner." },
];

const where = (o: AdminOpinion) =>
  o.season_number >= 0 ? `S${o.season_number}${o.episode_number >= 0 ? `:E${o.episode_number}` : ""}` : "";

/** The opinions, newest first, with Hide / Delete. For one person when `userId` is given. */
export function OpinionList({ userId }: { userId?: string }) {
  const [items, setItems] = useState<AdminOpinion[]>([]);
  const [total, setTotal] = useState(0);
  const [onlyHidden, setOnlyHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);

  const load = useCallback(
    async (offset = 0) => {
      try {
        const page = await listAdminOpinions(offset, onlyHidden, 30, userId);
        setItems((cur) => (offset === 0 ? page.items : [...cur, ...page.items]));
        setTotal(page.total);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't load opinions.");
      }
    },
    [onlyHidden, userId]
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  async function hide(o: AdminOpinion) {
    try {
      await hideAdminOpinion(o.id, !o.hidden);
      showToast(o.hidden ? "It's visible again." : "Hidden from everyone.", "success");
      await load(0);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't change that.");
    }
  }

  async function remove(o: AdminOpinion) {
    if (armed !== o.id) {
      setArmed(o.id);
      return;
    }
    try {
      await deleteAdminOpinion(o.id);
      setArmed(null);
      showToast("Deleted.", "success");
      await load(0);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't delete that.");
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-white">
          {onlyHidden ? "Hidden opinions" : userId ? "Their opinions" : "Latest opinions"} <span className="text-sm font-normal text-white/40">({total})</span>
        </h2>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-white/60">
          <input type="checkbox" className="accent-accent" checked={onlyHidden} onChange={(e) => setOnlyHidden(e.target.checked)} />
          Only hidden
        </label>
      </div>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {!error && items.length === 0 && <p className="text-sm text-white/50">{userId ? "No comments yet." : "Nothing here."}</p>}
      <ul className="divide-y divide-white/10 rounded-2xl border border-white/10">
        {items.map((o) => (
          <li key={o.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-xs text-white/50">
                <span className="font-medium text-white/80">{o.author_name}</span>
                {o.is_anonymous && <span className="rounded bg-white/10 px-1.5 py-0.5">posted anonymously</span>}
                {o.is_reply && <span className="rounded bg-white/10 px-1.5 py-0.5">reply</span>}
                {o.hidden && <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-red-300">hidden</span>}
                <span>{timeAgo(o.created_at)}</span>
                {o.likes > 0 && <span className="text-accent">♥ {o.likes}</span>}
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-white/85">{o.body}</p>
              <p className="mt-1 text-xs text-white/40">
                on{" "}
                <Link href={`/${o.media_type}/${o.tmdb_id}`} className="underline hover:text-white/70">
                  {o.title ?? `${o.media_type === "tv" ? "Show" : "Movie"} #${o.tmdb_id}`}
                </Link>{" "}
                {where(o)}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button type="button" className={quietButton} onClick={() => hide(o)}>
                {o.hidden ? "Show again" : "Hide"}
              </button>
              <button type="button" className={`${quietButton} ${armed === o.id ? "!bg-red-500/80 !text-white" : ""}`} onClick={() => remove(o)} onBlur={() => setArmed(null)}>
                {armed === o.id ? "Really delete?" : "Delete"}
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

export default function OpinionsTab() {
  const [config, setConfig] = useState<SocialConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSocialConfig().then(setConfig).catch((e) => setError(e instanceof Error ? e.message : "Couldn't load the switches."));
  }, []);

  async function flip(key: keyof SocialConfig, value: boolean) {
    if (!config) return;
    const before = config;
    setConfig({ ...config, [key]: value });
    try {
      setConfig(await saveSocialConfig({ ...config, [key]: value }));
    } catch (e) {
      setConfig(before);
      showToast(e instanceof Error ? e.message : "Couldn't save that.");
    }
  }

  return (
    <div className="space-y-6">
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <section className="rounded-2xl border border-white/10 bg-white/[0.03]">
        <h2 className="border-b border-white/10 px-5 py-4 text-base font-semibold text-white">Switches for everyone</h2>
        <ul className="divide-y divide-white/10">
          {SWITCHES.map((s) => (
            <li key={s.key} className="flex items-center justify-between gap-4 px-5 py-3">
              <div>
                <p className="text-sm font-medium text-white">{s.label}</p>
                <p className="text-sm text-white/50">{s.hint}</p>
              </div>
              <Toggle label={s.label} checked={config?.[s.key] ?? true} disabled={!config} onChange={(v) => flip(s.key, v)} />
            </li>
          ))}
        </ul>
        <p className="border-t border-white/10 px-5 py-3 text-xs text-white/40">To stop one person from writing, use “Mute opinions” in their menu on the Users tab.</p>
      </section>

      <OpinionList />
    </div>
  );
}
