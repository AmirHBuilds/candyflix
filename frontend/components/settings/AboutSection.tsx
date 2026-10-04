"use client";

import { useState } from "react";
import { useSettings } from "@/components/SettingsProvider";
import { SettingRow, SettingsCard } from "@/components/settings/controls";

export default function AboutSection() {
  const { reset } = useSettings();
  // Two-step so one stray tap can't wipe everything.
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <SettingsCard title="About CandyFlix">
        <div className="space-y-3 px-5 py-4 text-sm text-white/60">
          <p>A private, self-hosted streaming dashboard for you and the people close to you.</p>
          <p>
            Titles, posters and descriptions come from TMDB. Subtitles come from OpenSubtitles. This product uses
            the TMDB API but is not endorsed or certified by TMDB.
          </p>
        </div>
      </SettingsCard>

      <SettingsCard title="Settings">
        <SettingRow
          label="Reset all settings"
          description="Puts every setting on this account back to its default. Your watch history and saved list are not touched."
        >
          {confirming ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={async () => {
                  await reset();
                  setConfirming(false);
                }}
                className="h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent/90"
              >
                Yes, reset
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="h-10 rounded-xl border border-white/15 px-4 text-sm text-white/80 hover:bg-white/5"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="h-10 rounded-xl border border-white/15 px-4 text-sm text-white/80 hover:bg-white/5"
            >
              Reset…
            </button>
          )}
        </SettingRow>
      </SettingsCard>
    </>
  );
}
