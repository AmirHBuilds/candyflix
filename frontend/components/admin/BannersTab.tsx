"use client";

import { useEffect, useState } from "react";
import { fieldClass, primaryButton } from "@/components/admin/Dialog";
import { getAdminBanners, saveAdminBanners } from "@/lib/admin";
import type { HomeBannerContent, HomeBannersContent } from "@/lib/site";
import { showToast } from "@/lib/toast";

const SLOT_NAMES = ["Subtitles picture", "Resume picture", "Make-it-yours picture"];

export default function BannersTab() {
  const [data, setData] = useState<HomeBannersContent | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getAdminBanners().then(setData).catch((e) => setLoadError(e instanceof Error ? e.message : "Couldn't load the banners."));
  }, []);

  if (loadError) return <p role="alert" className="text-sm text-red-300">{loadError}</p>;
  if (!data) return <p className="text-sm text-white/50">Loading…</p>;

  const patch = (i: number, p: Partial<HomeBannerContent>) =>
    setData({ banners: data.banners.map((b, n) => (n === i ? { ...b, ...p } : b)) });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!data) return;
    setSaving(true);
    try {
      setData(await saveAdminBanners(data));
      showToast("Banners saved. They show on the home page.", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't save the banners.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} aria-label="Banners" className="max-w-2xl space-y-5">
      <p className="text-sm text-white/50">
        Three friendly banners on the home page, each between two rows of titles. Switch one off to hide it, or change its words. Each keeps its own picture.
      </p>
      {data.banners.map((b, i) => (
        <fieldset key={i} className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <legend className="px-1 text-sm font-medium text-white/80">
            Banner {i + 1} <span className="font-normal text-white/40">· {SLOT_NAMES[i]}</span>
          </legend>
          <label className="flex items-center gap-2 text-sm text-white/70">
            <input type="checkbox" checked={b.enabled} onChange={(e) => patch(i, { enabled: e.target.checked })} className="h-4 w-4 accent-accent" />
            Show banner {i + 1}
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-white/70">
            Title
            <input aria-label={`Banner ${i + 1} title`} value={b.title} onChange={(e) => patch(i, { title: e.target.value })} maxLength={60} className={fieldClass} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-white/70">
            Text
            <textarea
              aria-label={`Banner ${i + 1} text`}
              value={b.text}
              onChange={(e) => patch(i, { text: e.target.value })}
              maxLength={220}
              rows={3}
              className={`${fieldClass} h-auto py-2.5 leading-relaxed`}
            />
            <span className="text-xs text-white/40">{b.text.length}/220</span>
          </label>
        </fieldset>
      ))}
      <button type="submit" disabled={saving} className={primaryButton}>
        {saving ? "Saving…" : "Save banners"}
      </button>
    </form>
  );
}
