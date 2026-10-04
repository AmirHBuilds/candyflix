"use client";

import { useSettings } from "@/components/SettingsProvider";
import { SegmentedControl, SettingRow, SettingsCard, Toggle } from "@/components/settings/controls";
import { SUBTITLE_LANGUAGES } from "@/lib/languages";
import type { SeekSeconds } from "@/lib/settings";

const SEEK_OPTIONS: { value: SeekSeconds; label: string }[] = [5, 10, 15, 20, 30].map((s) => ({
  value: s as SeekSeconds,
  label: `${s}s`,
}));

const selectClass =
  "h-11 w-full max-w-64 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-sm text-white focus:border-accent focus:outline-none sm:w-64";

export default function PlaybackSettingsForm() {
  const { settings, update } = useSettings();
  const p = settings.playback;
  const auto = p.auto_subtitles;

  return (
    <>
      <SettingsCard title="Playing" description="What happens when you open a video and when it ends.">
        <SettingRow
          label="Start playing when a video opens"
          htmlFor="autoplay-open"
          description="Off: the video waits for you to press play. (Autoplay-next still starts the next episode by itself.)"
        >
          <Toggle id="autoplay-open" label="Start playing when a video opens" checked={p.autoplay_on_open} onChange={(autoplay_on_open) => update({ playback: { autoplay_on_open } })} />
        </SettingRow>
        <SettingRow
          label="Autoplay next episode"
          htmlFor="autoplay-next"
          description="When an episode ends, the next one starts after a 5-second “Up next” countdown you can cancel. It continues into the next season, and stops after the last episode."
        >
          <Toggle id="autoplay-next" label="Autoplay next episode" checked={p.autoplay_next} onChange={(autoplay_next) => update({ playback: { autoplay_next } })} />
        </SettingRow>
        <SettingRow
          label="Seek time"
          description="How far the arrow keys, J / L, and a double-tap on the left or right of the video skip."
        >
          <SegmentedControl
            label="Seek time"
            value={p.seek_seconds}
            options={SEEK_OPTIONS}
            onChange={(seek_seconds) => update({ playback: { seek_seconds } })}
          />
        </SettingRow>
      </SettingsCard>

      <SettingsCard title="Subtitles on start" description="Which captions a video starts with.">
        <SettingRow
          label="Choose subtitles automatically"
          htmlFor="auto-subs"
          description="Off: a video starts with whatever language you last picked in the player (or none)."
        >
          <Toggle
            id="auto-subs"
            label="Choose subtitles automatically"
            checked={auto.enabled}
            onChange={(enabled) => update({ playback: { auto_subtitles: { enabled } } })}
          />
        </SettingRow>
        {auto.enabled && (
          <>
            <SettingRow label="Preferred language" htmlFor="auto-subs-lang" description="Looked up for each video; if it can't be found, the backup language is tried.">
              <select
                id="auto-subs-lang"
                value={auto.language}
                onChange={(e) => update({ playback: { auto_subtitles: { language: e.target.value } } })}
                className={selectClass}
              >
                {SUBTITLE_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </SettingRow>
            <SettingRow label="Backup language" htmlFor="auto-subs-fallback">
              <select
                id="auto-subs-fallback"
                value={auto.fallback_language ?? ""}
                onChange={(e) =>
                  update({ playback: { auto_subtitles: { fallback_language: e.target.value === "" ? null : e.target.value } } })
                }
                className={selectClass}
              >
                <option value="">None</option>
                {SUBTITLE_LANGUAGES.filter((l) => l.code !== auto.language).map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </SettingRow>
          </>
        )}
      </SettingsCard>

      <SettingsCard
        title="Skipping"
        description="Intro, recap and credits come from the community databases SkipDB and IntroDB. Not every title has them."
      >
        <SettingRow
          label="Skip intro automatically"
          htmlFor="auto-skip-intro"
          description="Jumps past the intro as soon as it starts, once per video. If you rewind into it, it stays put."
        >
          <Toggle id="auto-skip-intro" label="Skip intro automatically" checked={p.auto_skip_intro} onChange={(auto_skip_intro) => update({ playback: { auto_skip_intro } })} />
        </SettingRow>
        <SettingRow label="Skip Intro button" htmlFor="skip-btn-intro" description="Shows a button while the intro plays. It fades away with the player controls.">
          <Toggle id="skip-btn-intro" label="Skip Intro button" checked={p.skip_buttons.intro} onChange={(intro) => update({ playback: { skip_buttons: { intro } } })} />
        </SettingRow>
        <SettingRow label="Skip Recap button" htmlFor="skip-btn-recap" description="For the “previously on…” part at the start of an episode.">
          <Toggle id="skip-btn-recap" label="Skip Recap button" checked={p.skip_buttons.recap} onChange={(recap) => update({ playback: { skip_buttons: { recap } } })} />
        </SettingRow>
        <SettingRow label="Skip Credits button" htmlFor="skip-btn-credits" description="Jumps to the end of the credits (and on to the next episode, if autoplay is on).">
          <Toggle id="skip-btn-credits" label="Skip Credits button" checked={p.skip_buttons.credits} onChange={(credits) => update({ playback: { skip_buttons: { credits } } })} />
        </SettingRow>
      </SettingsCard>

      <SettingsCard title="Remembering" description="What CandyFlix keeps for you.">
        <SettingRow
          label="Save watch progress"
          htmlFor="save-progress"
          description="Remembers where you stopped and jumps back there. Off: videos always start from the beginning. Your last-watched episode and Continue Watching still work either way."
        >
          <Toggle id="save-progress" label="Save watch progress" checked={p.save_progress} onChange={(save_progress) => update({ playback: { save_progress } })} />
        </SettingRow>
        <SettingRow
          label="Remember settings per video"
          htmlFor="remember-per-video"
          description="Keeps the volume, subtitle language and subtitle timing you chose for each movie or episode separately."
        >
          <Toggle id="remember-per-video" label="Remember settings per video" checked={p.remember_per_video} onChange={(remember_per_video) => update({ playback: { remember_per_video } })} />
        </SettingRow>
      </SettingsCard>
    </>
  );
}
