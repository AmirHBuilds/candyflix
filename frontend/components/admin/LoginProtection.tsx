"use client";

import { useCallback, useEffect, useState } from "react";
import { fieldClass, primaryButton, quietButton } from "@/components/admin/Dialog";
import { Toggle } from "@/components/settings/controls";
import { getLogins, liftBlock, saveLoginConfig, type LoginBlock, type LoginGuardConfig, type LoginsOverview } from "@/lib/admin";
import { timeAgo } from "@/lib/opinions";
import { showToast } from "@/lib/toast";

const card = "rounded-2xl border border-white/10 bg-white/[0.03]";

function left(seconds: number): string {
  const m = Math.max(1, Math.round(seconds / 60));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min left` : `${m} min left`;
}

function BlockRow({ b, onLift }: { b: LoginBlock; onLift: (b: LoginBlock) => void }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
      <div className="min-w-0">
        <p className="text-sm text-white/90">
          <span className="mr-2 rounded bg-white/10 px-1.5 py-0.5 text-xs text-white/60">{b.scope === "name" ? "Name" : "Address"}</span>
          <span className="font-mono">{b.key}</span>
          {b.strikes > 1 && <span className="ml-2 text-xs text-amber-300">repeat #{b.strikes}</span>}
        </p>
        <p className="mt-0.5 text-xs text-white/50">
          {b.fails} wrong passwords · {left(b.seconds_left)}
          {b.others.length > 0 && (b.scope === "name" ? ` · from ${b.others.join(", ")}` : ` · names tried: ${b.others.join(", ")}`)}
        </p>
      </div>
      <button type="button" className={quietButton} aria-label={`Lift the block on ${b.key}`} onClick={() => onLift(b)}>
        Lift block
      </button>
    </li>
  );
}

/** Wrong-password limits: who is blocked now, the limits, the recent wrong tries, and who has no two-step sign-in. */
export default function LoginProtection() {
  const [data, setData] = useState<LoginsOverview | null>(null);
  const [cfg, setCfg] = useState<LoginGuardConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await getLogins();
      setData(d);
      setCfg((c) => c ?? d.config);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the sign-in protection.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!cfg) return;
    setBusy(true);
    try {
      setCfg(await saveLoginConfig(cfg));
      showToast("Saved.", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't save that.");
    } finally {
      setBusy(false);
    }
  }

  async function lift(b: LoginBlock) {
    try {
      await liftBlock(b.scope, b.key);
      showToast("Block lifted.", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't lift that block.");
    } finally {
      void load();
    }
  }

  const num = (key: keyof LoginGuardConfig, min: number, max: number) => (
    <input
      type="number"
      min={min}
      max={max}
      value={cfg ? Number(cfg[key]) : 0}
      onChange={(e) => cfg && setCfg({ ...cfg, [key]: Number(e.target.value) })}
      className={`${fieldClass} mt-1 w-28`}
    />
  );

  const events = data ? (showAll ? data.events : data.events.slice(0, 10)) : [];
  return (
    <div className="space-y-6">
      <div className={card}>
        <header className="flex flex-col gap-3 border-b border-white/10 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div>
            <h2 className="text-base font-semibold text-white">Wrong passwords</h2>
            <p className="mt-0.5 text-sm text-white/50">
              Too many wrong passwords for one name, or from one address, blocks further tries for a while. The first block is {cfg?.lockout_minutes ?? 15} minutes; if it happens again within a day it doubles (never more than four times). A blocked try gets the same message even when the password is right, so a guesser never learns they were close. A name block lets through an address that person has already signed in from, so a stranger can&apos;t lock them out at home. You hear about each new block here and on Telegram.
            </p>
          </div>
          <button type="button" className={`${quietButton} self-start`} onClick={load}>
            Refresh
          </button>
        </header>
        {error && (
          <p role="alert" className="px-5 py-4 text-sm text-red-300">
            {error}
          </p>
        )}
        {cfg && (
          <div className="space-y-4 border-b border-white/10 px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-white">Block repeated wrong passwords</p>
              <Toggle checked={cfg.enabled} onChange={(v) => setCfg({ ...cfg, enabled: v })} label="Block repeated wrong passwords" />
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <label className="text-sm text-white/70">
                Wrong tries per name
                {num("name_failures", 2, 50)}
              </label>
              <label className="text-sm text-white/70">
                Wrong tries per address
                {num("ip_failures", 3, 500)}
              </label>
              <label className="text-sm text-white/70">
                within minutes
                {num("window_minutes", 1, 1440)}
              </label>
              <label className="text-sm text-white/70">
                Block for minutes
                {num("lockout_minutes", 1, 1440)}
              </label>
              <button type="button" disabled={busy} className={primaryButton} aria-label="Save sign-in limits" onClick={save}>
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        )}
        <div>
          <h3 className="px-5 pt-4 text-sm font-semibold text-white">Blocked now</h3>
          {data && data.blocks.length === 0 && <p className="px-5 py-3 text-sm text-white/50">Nobody is blocked.</p>}
          {data && data.blocks.length > 0 && (
            <ul className="mt-1 divide-y divide-white/10">
              {data.blocks.map((b) => (
                <BlockRow key={`${b.scope}:${b.key}`} b={b} onLift={lift} />
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className={card}>
        <header className="border-b border-white/10 px-5 py-4">
          <h2 className="text-base font-semibold text-white">Recent wrong tries</h2>
          <p className="mt-0.5 text-sm text-white/50">Every wrong password and every block, kept for 30 days. The name is what was typed, so it may not be a real account.</p>
        </header>
        {data && data.events.length === 0 && <p className="px-5 py-4 text-sm text-white/50">None yet.</p>}
        {events.length > 0 && (
          <ul className="divide-y divide-white/10">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-2.5 text-sm">
                <span className="text-white/90">
                  {e.kind === "blocked" && <span className="mr-2 rounded bg-red-500/15 px-1.5 py-0.5 text-xs text-red-300">blocked</span>}
                  {e.username ? <span className="font-mono">{e.username}</span> : <span className="text-white/40">any name</span>}
                  <span className="ml-2 text-xs text-white/50">{e.detail}</span>
                </span>
                <span className="text-xs text-white/40">
                  <span className="font-mono">{e.ip ?? "unknown"}</span> · {timeAgo(e.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {data && data.events.length > 10 && (
          <div className="border-t border-white/10 px-5 py-3">
            <button type="button" className={quietButton} onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show fewer" : `Show all ${data.events.length}`}
            </button>
          </div>
        )}
      </div>

      {data && data.two_step_available && (
        <div className={card}>
          <header className="border-b border-white/10 px-5 py-4">
            <h2 className="text-base font-semibold text-white">Two-step sign-in</h2>
            <p className="mt-0.5 text-sm text-white/50">With two-step sign-in a stolen password isn&apos;t enough: a code from the bot is needed too. Each person turns it on in their own Settings.</p>
          </header>
          {data.without_two_step.length === 0 ? (
            <p className="px-5 py-4 text-sm text-white/50">Everyone has it on.</p>
          ) : (
            <p className="px-5 py-4 text-sm text-white/70">
              Not on yet: {data.without_two_step.map((p) => `${p.display_name}${p.is_admin ? " (admin)" : ""}`).join(", ")}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
