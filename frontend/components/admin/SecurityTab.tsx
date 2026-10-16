"use client";

import { useCallback, useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import { fieldClass, primaryButton, quietButton } from "@/components/admin/Dialog";
import { REST_CHOICES, restLabel, useAdminNotices } from "@/components/admin/useAdminNotices";
import { Toggle } from "@/components/settings/controls";
import { getSharing, getSharingConfig, saveSharingConfig, type SharingConfig, type SharingOverview, type SharingPerson } from "@/lib/admin";
import { timeAgo } from "@/lib/opinions";
import { showToast } from "@/lib/toast";

const card = "rounded-2xl border border-white/10 bg-white/[0.03]";

function Notifications() {
  const { data, rest } = useAdminNotices();
  if (!data) return null;
  return (
    <div className={card}>
      <header className="border-b border-white/10 px-5 py-4">
        <h2 className="text-base font-semibold text-white">Your notifications</h2>
        <p className="mt-0.5 text-sm text-white/50">
          While you are on the site, a pop-up and the bell tell you about new feedback and accounts used from many places. Resting only affects you, and nothing is lost: the bell still lists everything. Telegram reports are not affected.
        </p>
      </header>
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-white/80">{restLabel(data)}</p>
        <div className="flex flex-wrap gap-2">
          {data.resting ? (
            <button type="button" className={primaryButton} onClick={() => rest(0)}>
              Switch notifications on
            </button>
          ) : (
            REST_CHOICES.map((c) => (
              <button key={c.label} type="button" className={quietButton} onClick={() => rest(c.minutes)}>
                Rest: {c.label}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function Settings({ onSaved }: { onSaved: () => void }) {
  const [cfg, setCfg] = useState<SharingConfig | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    getSharingConfig()
      .then(setCfg)
      .catch(() => setCfg(null));
  }, []);
  if (!cfg) return null;

  async function save() {
    if (!cfg) return;
    setBusy(true);
    try {
      setCfg(await saveSharingConfig(cfg));
      showToast("Saved.", "success");
      onSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't save that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={card}>
      <header className="border-b border-white/10 px-5 py-4">
        <h2 className="text-base font-semibold text-white">Shared accounts</h2>
        <p className="mt-0.5 text-sm text-white/50">
          Every sign-in keeps the address it came from. When one account signs in from too many different addresses in a short time, you are told once (and again no sooner than 12 hours later). Phones change address often, so keep the number a little high.
        </p>
      </header>
      <div className="space-y-4 px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-white">Look for shared accounts</p>
          <Toggle checked={cfg.enabled} onChange={(v) => setCfg({ ...cfg, enabled: v })} label="Look for shared accounts" />
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-sm text-white/70">
            Different addresses
            <input type="number" min={2} max={50} value={cfg.max_ips} onChange={(e) => setCfg({ ...cfg, max_ips: Number(e.target.value) })} className={`${fieldClass} mt-1 w-28`} />
          </label>
          <label className="text-sm text-white/70">
            within hours
            <input type="number" min={1} max={720} value={cfg.window_hours} onChange={(e) => setCfg({ ...cfg, window_hours: Number(e.target.value) })} className={`${fieldClass} mt-1 w-28`} />
          </label>
          <button type="button" disabled={busy} className={primaryButton} onClick={save}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Person({ p, onView }: { p: SharingPerson; onView: (id: string) => void }) {
  const [open, setOpen] = useState(p.flagged);
  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-3">
        <Avatar name={p.display_name} src={p.avatar_url} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-white/90">
            {p.display_name}
            {p.flagged && <span className="ml-2 rounded bg-red-500/15 px-1.5 py-0.5 text-xs text-red-300">may be shared</span>}
            {p.is_disabled && <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-xs text-white/60">disabled</span>}
          </p>
          <p className="text-xs text-white/40">
            @{p.username} · {p.distinct_ips} different addresses · {p.sign_ins} {p.sign_ins === 1 ? "sign-in" : "sign-ins"}
          </p>
        </div>
        <button type="button" className={quietButton} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? "Hide" : "Addresses"}
        </button>
        <button type="button" className={quietButton} onClick={() => onView(p.user_id)}>
          Open
        </button>
      </div>
      {open && (
        <ul className="mt-3 divide-y divide-white/10 rounded-xl border border-white/10 bg-black/20">
          {p.ips.map((i) => (
            <li key={i.ip} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2 text-xs">
              <span className="font-mono text-sm text-white/90">{i.ip}</span>
              <span className="text-white/50">{i.devices.join(", ")}</span>
              <span className="text-white/40">
                {i.sign_ins} {i.sign_ins === 1 ? "sign-in" : "sign-ins"} · last {timeAgo(i.last_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Account sharing, the admin's own notifications and rest mode. */
export default function SecurityTab({ onViewPerson }: { onViewPerson: (id: string) => void }) {
  const [data, setData] = useState<SharingOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await getSharing());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't check the sign-in addresses.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section aria-label="Security" className="space-y-6">
      <Notifications />
      <Settings onSaved={load} />
      <div className={card}>
        <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-white">Signed in from several addresses</h2>
            <p className="mt-0.5 text-sm text-white/50">
              {data ? `The last ${data.window_hours} hours. Everyone with two or more addresses is listed, those at ${data.max_ips} or more first.` : "Checking…"}
            </p>
          </div>
          <button type="button" className={quietButton} onClick={load}>
            Refresh
          </button>
        </header>
        {error && (
          <p role="alert" className="px-5 py-4 text-sm text-red-300">
            {error}
          </p>
        )}
        {data && data.people.length === 0 && <p className="px-5 py-4 text-sm text-white/50">Nobody has signed in from more than one address. The full list of sign-ins is under Log.</p>}
        {data && data.people.length > 0 && (
          <ul className="divide-y divide-white/10">
            {data.people.map((p) => (
              <Person key={p.user_id} p={p} onView={onViewPerson} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
