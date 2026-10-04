"use client";

import { useCallback, useEffect, useState } from "react";
import { quietButton } from "@/components/admin/Dialog";
import { clearSubtitleCache, clearTmdbCache, getSystemStatus, type ServiceCheck, type SystemStatus } from "@/lib/admin";
import { showToast } from "@/lib/toast";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function Check({ name, check }: { name: string; check: ServiceCheck }) {
  return (
    <li className="flex items-start gap-3 px-5 py-3.5">
      <span
        role="img"
        aria-label={check.ok ? "OK" : "Problem"}
        className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${check.ok ? "bg-emerald-400" : "bg-red-400"}`}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-white">{name}</p>
        <p className="text-sm text-white/50">{check.detail}</p>
      </div>
      {check.latency_ms !== null && <span className="shrink-0 text-xs text-white/40">{check.latency_ms} ms</span>}
    </li>
  );
}

export default function SystemTab() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"tmdb" | "subs" | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await getSystemStatus());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't check the system.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function clear(which: "tmdb" | "subs") {
    setBusy(which);
    try {
      const { cleared } = await (which === "tmdb" ? clearTmdbCache() : clearSubtitleCache());
      showToast(`Cleared ${cleared} ${cleared === 1 ? "item" : "items"}.`, "success");
      load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't clear the cache.");
    } finally {
      setBusy(null);
    }
  }

  if (error && !status) {
    return (
      <div role="alert" className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-200">
        {error}{" "}
        <button type="button" onClick={load} className="underline">
          Try again
        </button>
      </div>
    );
  }
  if (!status) return <p className="text-sm text-white/50">Checking services…</p>;

  return (
    <section aria-label="System" className="space-y-6">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03]">
        <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 className="text-base font-semibold text-white">Health</h2>
          <button type="button" onClick={load} className={quietButton}>
            Check again
          </button>
        </header>
        <ul className="divide-y divide-white/10">
          <Check name="Database" check={status.database} />
          <Check name="Redis" check={status.redis} />
          <Check name="TMDB" check={status.tmdb} />
          <Check name="OpenSubtitles" check={status.opensubtitles} />
        </ul>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03]">
        <header className="border-b border-white/10 px-5 py-4">
          <h2 className="text-base font-semibold text-white">Caches</h2>
          <p className="mt-0.5 text-sm text-white/50">Safe to clear — they refill on demand.</p>
        </header>
        <div className="divide-y divide-white/10">
          <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-white">TMDB data</p>
              <p className="text-sm text-white/50">Cached movie and show details. Clear it to pick up fresh data from TMDB.</p>
            </div>
            <button type="button" disabled={busy !== null} onClick={() => clear("tmdb")} className={quietButton}>
              {busy === "tmdb" ? "Clearing…" : "Clear TMDB cache"}
            </button>
          </div>
          <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-white">Downloaded subtitles</p>
              <p className="text-sm text-white/50">
                {status.subtitle_cache.files} {status.subtitle_cache.files === 1 ? "file" : "files"}, {formatBytes(status.subtitle_cache.bytes)}
              </p>
            </div>
            <button type="button" disabled={busy !== null} onClick={() => clear("subs")} className={quietButton}>
              {busy === "subs" ? "Clearing…" : "Clear subtitle cache"}
            </button>
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {[
          ["App version", status.app_version],
          ["Python", status.python_version],
          ["Profile pictures", `${status.avatars.files} (${formatBytes(status.avatars.bytes)})`],
          ["Auto-migrate", status.auto_migrate ? "On" : "Off"],
        ].map(([k, v]) => (
          <div key={k} className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <dt className="text-xs text-white/40">{k}</dt>
            <dd className="mt-0.5 text-white/80">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
