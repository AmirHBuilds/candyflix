"use client";

import { useState } from "react";
import { SettingRow, SettingsCard } from "@/components/settings/controls";
import { clearVideoSettings, clearWatchHistory } from "@/lib/playback";
import { showToast } from "@/lib/toast";

const dangerClass =
  "h-10 rounded-xl bg-red-500/90 px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";
const quietClass =
  "h-10 rounded-xl bg-white/10 px-4 text-sm font-medium text-white/80 transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40";

/** A button that needs a second click ("Really clear?") before it acts. */
function TwoStepButton({
  label,
  confirmLabel,
  busyLabel,
  onConfirm,
}: {
  label: string;
  confirmLabel: string;
  busyLabel: string;
  onConfirm: () => Promise<void>;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
      setArmed(false);
    }
  }

  if (!armed) {
    return (
      <button type="button" className={quietClass} onClick={() => setArmed(true)}>
        {label}
      </button>
    );
  }
  return (
    <div className="flex gap-2">
      <button type="button" className={quietClass} disabled={busy} onClick={() => setArmed(false)}>
        Cancel
      </button>
      <button type="button" className={dangerClass} disabled={busy} onClick={go}>
        {busy ? busyLabel : confirmLabel}
      </button>
    </div>
  );
}

export default function PrivacyDataForm() {
  return (
    <SettingsCard title="Privacy & data" description="Things CandyFlix remembers about what you watch.">
      <SettingRow
        label="Watch history"
        description="Forgets where you stopped in every movie and episode, your last-watched episodes and your Continue Watching row. Your saved list isn't touched."
      >
        <TwoStepButton
          label="Clear watch history"
          confirmLabel="Yes, clear it"
          busyLabel="Clearing…"
          onConfirm={async () => {
            try {
              const n = await clearWatchHistory();
              showToast(n === 0 ? "There was nothing to clear." : "Watch history cleared.", "success");
            } catch (err) {
              showToast(err instanceof Error ? err.message : "Couldn't clear your watch history.");
            }
          }}
        />
      </SettingRow>
      <SettingRow
        label="Per-video settings"
        description="Forgets the volume and subtitle language remembered for individual movies and episodes. Your general settings stay."
      >
        <TwoStepButton
          label="Reset per-video settings"
          confirmLabel="Yes, reset them"
          busyLabel="Resetting…"
          onConfirm={async () => {
            try {
              const n = await clearVideoSettings();
              showToast(n === 0 ? "There was nothing to reset." : "Per-video settings reset.", "success");
            } catch (err) {
              showToast(err instanceof Error ? err.message : "Couldn't reset the per-video settings.");
            }
          }}
        />
      </SettingRow>
    </SettingsCard>
  );
}
