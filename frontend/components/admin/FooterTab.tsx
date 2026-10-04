"use client";

import { useEffect, useState } from "react";
import { fieldClass, primaryButton, quietButton } from "@/components/admin/Dialog";
import { getAdminFooter, saveAdminFooter } from "@/lib/admin";
import type { FooterContent } from "@/lib/site";
import { showToast } from "@/lib/toast";

const MAX_LINKS = 8;

export default function FooterTab() {
  const [footer, setFooter] = useState<FooterContent | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getAdminFooter().then(setFooter).catch((e) => setLoadError(e instanceof Error ? e.message : "Couldn't load the footer."));
  }, []);

  if (loadError) return <p role="alert" className="text-sm text-red-300">{loadError}</p>;
  if (!footer) return <p className="text-sm text-white/50">Loading…</p>;

  const set = (patch: Partial<FooterContent>) => setFooter({ ...footer, ...patch });
  const setLink = (i: number, patch: Partial<{ label: string; url: string }>) =>
    set({ links: footer.links.map((l, n) => (n === i ? { ...l, ...patch } : l)) });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!footer) return;
    setSaving(true);
    try {
      setFooter(await saveAdminFooter(footer));
      showToast("Footer saved. It shows on every page.", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't save the footer.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} aria-label="Footer" className="max-w-2xl space-y-5">
      <p className="text-sm text-white/50">The small block at the bottom of every page, for everyone.</p>
      <label className="flex items-center gap-2 text-sm text-white/70">
        <input type="checkbox" checked={footer.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="h-4 w-4 accent-accent" />
        Show the footer
      </label>
      <label className="flex flex-col gap-1.5 text-sm text-white/70">
        Tagline
        <input value={footer.tagline} onChange={(e) => set({ tagline: e.target.value })} maxLength={160} className={fieldClass} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm text-white/70">
        Contact email
        <input type="email" value={footer.email} onChange={(e) => set({ email: e.target.value })} maxLength={120} placeholder="you@example.com" className={fieldClass} />
        <span className="text-xs text-white/40">Leave empty to hide it.</span>
      </label>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm text-white/70">Links</legend>
        {footer.links.map((l, i) => (
          <div key={i} className="flex flex-col gap-2 sm:flex-row">
            <input aria-label={`Link ${i + 1} label`} value={l.label} onChange={(e) => setLink(i, { label: e.target.value })} maxLength={40} placeholder="Label" className={`${fieldClass} sm:w-48`} />
            <input aria-label={`Link ${i + 1} address`} value={l.url} onChange={(e) => setLink(i, { url: e.target.value })} maxLength={300} placeholder="https://… or /page" className={fieldClass} />
            <button type="button" aria-label={`Remove link ${i + 1}`} onClick={() => set({ links: footer.links.filter((_, n) => n !== i) })} className={quietButton}>
              Remove
            </button>
          </div>
        ))}
        {footer.links.length < MAX_LINKS && (
          <button type="button" onClick={() => set({ links: [...footer.links, { label: "", url: "" }] })} className={quietButton}>
            Add a link
          </button>
        )}
      </fieldset>
      <label className="flex flex-col gap-1.5 text-sm text-white/70">
        Copyright name
        <input value={footer.copyright} onChange={(e) => set({ copyright: e.target.value })} maxLength={80} className={fieldClass} />
        <span className="text-xs text-white/40">Shown as “© year name”.</span>
      </label>
      <button type="submit" disabled={saving} className={primaryButton}>
        {saving ? "Saving…" : "Save footer"}
      </button>
    </form>
  );
}
