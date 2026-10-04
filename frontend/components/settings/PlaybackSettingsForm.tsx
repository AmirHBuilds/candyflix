"use client";

import { useSettings } from "@/components/SettingsProvider";
import { SegmentedControl, SettingRow, SettingsCard } from "@/components/settings/controls";
import type { SeekSeconds } from "@/lib/settings";

const SEEK_OPTIONS: { value: SeekSeconds; label: string }[] = [5, 10, 15, 20, 30].map((s) => ({
  value: s as SeekSeconds,
  label: `${s}s`,
}));

export default function PlaybackSettingsForm() {
  const { settings, update } = useSettings();

  return (
    <SettingsCard title="Playback" description="How the player behaves.">
      <SettingRow
        label="Seek time"
        description="How far the arrow keys, J / L, and a double-tap on the left or right of the video skip."
      >
        <SegmentedControl
          label="Seek time"
          value={settings.playback.seek_seconds}
          options={SEEK_OPTIONS}
          onChange={(seek_seconds) => update({ playback: { seek_seconds } })}
        />
      </SettingRow>
    </SettingsCard>
  );
}
