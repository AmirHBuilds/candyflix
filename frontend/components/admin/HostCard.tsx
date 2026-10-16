"use client";

import { useCallback, useEffect, useState } from "react";
import { quietButton } from "@/components/admin/Dialog";
import { getHostStatus, type HostStatus } from "@/lib/admin";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export function formatDuration(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** A filled bar that turns amber, then red, as it fills up. */
function Meter({ label, percent, left, right }: { label: string; percent: number; left: string; right: string }) {
  const p = Math.max(0, Math.min(100, percent));
  const tone = p >= 90 ? "bg-red-400" : p >= 75 ? "bg-amber-400" : "bg-emerald-400";
  return (
    <div className="px-5 py-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-white">{label}</p>
        <p className="text-xs text-white/50">{right}</p>
      </div>
      <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p)} className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${p}%` }} />
      </div>
      <p className="mt-1.5 text-xs text-white/40">{left}</p>
    </div>
  );
}

function Fact({ name, value, hint }: { name: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <dt className="text-xs text-white/40">{name}</dt>
      <dd className="mt-0.5 text-sm text-white/85">{value}</dd>
      {hint && <dd className="text-xs text-white/40">{hint}</dd>}
    </div>
  );
}

/** The server's own numbers: memory, processor, disk space, database size, uptime. Refreshes itself every 20 seconds. */
export default function HostCard() {
  const [host, setHost] = useState<HostStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setHost(await getHostStatus());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read the server's numbers.");
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  if (error && !host) {
    return (
      <p role="alert" className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
        {error}
      </p>
    );
  }
  if (!host) return <p className="text-sm text-white/50">Reading the server…</p>;

  const mem = host.memory;
  const memTotal = mem?.limit ?? mem?.total ?? 0;
  const memUsed = mem?.limit ? (mem.container_used ?? mem.used) : (mem?.used ?? 0);
  const cpu = host.cpu;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03]">
      <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-white">Server</h2>
          <p className="mt-0.5 text-sm text-white/50">Updates every 20 seconds.</p>
        </div>
        <button type="button" onClick={load} className={quietButton}>
          Refresh
        </button>
      </header>
      <div className="divide-y divide-white/10">
        {host.disks.map((d) => (
          <Meter key={d.path} label={`Disk space: ${d.label}`} percent={(d.used / Math.max(d.total, 1)) * 100} left={`${formatBytes(d.free)} free of ${formatBytes(d.total)}`} right={`${Math.round((d.used / Math.max(d.total, 1)) * 100)}% used`} />
        ))}
        {mem && memTotal > 0 && (
          <Meter
            label="Memory"
            percent={(memUsed / memTotal) * 100}
            left={`${formatBytes(Math.max(memTotal - memUsed, 0))} free of ${formatBytes(memTotal)}${mem.limit ? " (this container's limit)" : ""}${mem.swap_total ? ` · swap ${formatBytes(mem.swap_used)} of ${formatBytes(mem.swap_total)}` : ""}`}
            right={`${Math.round((memUsed / memTotal) * 100)}% used`}
          />
        )}
        {cpu && (
          <Meter
            label="Processor load"
            percent={(cpu.load_1 / cpu.cores) * 100}
            left={`Load over 1, 5 and 15 minutes: ${cpu.load_1.toFixed(2)}, ${cpu.load_5.toFixed(2)}, ${cpu.load_15.toFixed(2)} · ${cpu.cores} ${cpu.cores === 1 ? "core" : "cores"}`}
            right={`${Math.round((cpu.load_1 / cpu.cores) * 100)}% of capacity`}
          />
        )}
      </div>
      <dl className="grid grid-cols-2 gap-3 border-t border-white/10 p-5 sm:grid-cols-3 lg:grid-cols-4">
        <Fact name="Watching right now" value={String(host.watching_now)} />
        <Fact name="App running for" value={formatDuration(host.uptime.app_seconds)} hint={host.uptime.app_memory ? `using ${formatBytes(host.uptime.app_memory)} of memory` : undefined} />
        {host.uptime.host_seconds !== null && <Fact name="Server up for" value={formatDuration(host.uptime.host_seconds)} />}
        {host.database && <Fact name="Database" value={formatBytes(host.database.bytes)} hint={`${host.database.connections} open connections`} />}
        {host.redis && <Fact name="Redis" value={formatBytes(host.redis.bytes)} hint={`${host.redis.keys} keys`} />}
        {host.resolver && <Fact name="Video service" value={host.resolver.ok ? "Answering" : "Not answering"} hint={host.resolver.ok ? (host.resolver.latency_ms !== null ? `${host.resolver.latency_ms} ms` : undefined) : host.resolver.detail} />}
        {host.folders.map((f) => (
          <Fact key={f.label} name={f.label} value={formatBytes(f.bytes)} hint={`${f.files} ${f.files === 1 ? "file" : "files"}`} />
        ))}
      </dl>
    </div>
  );
}
