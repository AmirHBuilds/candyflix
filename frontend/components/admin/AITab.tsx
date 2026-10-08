"use client";

import { useEffect, useState } from "react";
import { fieldClass, primaryButton, quietButton } from "@/components/admin/Dialog";
import { getAdminAI, saveAdminAIConfig, setUserAIHistory, type AdminAIOverview } from "@/lib/admin";
import { showToast } from "@/lib/toast";

function limitText(limit: number | null) {
  return limit === null ? "No limit" : limit === 0 ? "Off" : `${limit} a day`;
}

export default function AITab({ onViewPerson }: { onViewPerson?: (id: string) => void }) {
  const [data, setData] = useState<AdminAIOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [limit, setLimit] = useState("5");
  const [saving, setSaving] = useState(false);

  const apply = (d: AdminAIOverview) => {
    setData(d);
    setEnabled(d.enabled);
    setLimit(String(d.default_daily_limit));
  };

  useEffect(() => {
    getAdminAI().then(apply).catch((e) => setLoadError(e instanceof Error ? e.message : "Couldn't load the AI settings."));
  }, []);

  if (loadError) return <p role="alert" className="text-sm text-red-300">{loadError}</p>;
  if (!data) return <p className="text-sm text-white/50">Loading…</p>;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(limit);
    if (limit.trim() === "" || !Number.isInteger(n) || n < 0 || n > 1000) return showToast("Enter a whole number from 0 to 1000.");
    setSaving(true);
    try {
      apply(await saveAdminAIConfig({ enabled, default_daily_limit: n }));
      showToast("AI settings saved.", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't save the AI settings.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleHistory(id: string, on: boolean) {
    try {
      await setUserAIHistory(id, on);
      setData((d) => d && { ...d, users: d.users.map((u) => (u.id === id ? { ...u, use_history: on } : u)) });
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't save that.");
    }
  }

  const changed = enabled !== data.enabled || limit !== String(data.default_daily_limit);

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <span
          role="img"
          aria-label={data.key_configured ? "OK" : "Problem"}
          className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${data.key_configured ? "bg-emerald-400" : "bg-red-400"}`}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white">Gemini</p>
          <p className="text-sm text-white/50">
            {data.key_configured ? `API key set · ${data.model}` : "No API key. Add GEMINI_API_KEY on the server to turn Ask AI on."}
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold text-white">{data.asks_today}</p>
          <p className="text-xs text-white/40">AI searches today</p>
        </div>
      </div>

      <form onSubmit={save} aria-label="AI settings" className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <h3 className="text-sm font-semibold text-white">For everyone</h3>
        <label className="flex items-center gap-2 text-sm text-white/70">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-accent" />
          Ask AI is on
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-white/70">
          AI searches a day, per person
          <input aria-label="Usual AI searches a day" inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} className={`${fieldClass} w-28`} />
          <span className="text-xs text-white/40">People with their own number below keep it. Admins have no limit. Counts reset at midnight UTC.</span>
        </label>
        <button type="submit" disabled={saving || !changed} className={primaryButton}>
          {saving ? "Saving…" : "Save"}
        </button>
      </form>

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
        <h3 className="px-5 pt-4 text-sm font-semibold text-white">People</h3>
        <p className="px-5 pb-3 text-xs text-white/40">Change a person's own number from their page.</p>
        <ul className="divide-y divide-white/5">
          {data.users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">
                  {u.display_name} {u.is_admin && <span className="text-xs font-normal text-white/40">· admin</span>}
                </p>
                <p className="text-xs text-white/40">
                  {u.used_today} used today · {limitText(u.effective_limit)}
                  {u.ai_daily_limit !== null && !u.is_admin && " (their own)"}
                </p>
              </div>
              <label className="flex items-center gap-2 text-xs text-white/60">
                <input
                  type="checkbox"
                  aria-label={`Use watch history for ${u.display_name}`}
                  checked={u.use_history}
                  onChange={(e) => void toggleHistory(u.id, e.target.checked)}
                  className="h-4 w-4 accent-accent"
                />
                Uses history
              </label>
              {onViewPerson && (
                <button type="button" onClick={() => onViewPerson(u.id)} className={quietButton}>
                  Open
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
