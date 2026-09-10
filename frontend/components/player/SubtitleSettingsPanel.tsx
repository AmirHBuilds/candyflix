"use client";

import { FONT_OPTIONS, type SubtitleSettings } from "@/components/player/subtitle-settings";
import type { SubtitleTrack } from "@/lib/playback";

const rowClass = "flex flex-col gap-1.5";
const labelClass = "text-xs font-medium uppercase tracking-wide text-white/40";
const selectClass =
  "w-full appearance-none rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white outline-none focus:border-[#FF5FA2]/60";
const rangeClass = "w-full accent-[#FF5FA2]";

export default function SubtitleSettingsPanel({
  tracks,
  selectedLanguage,
  onSelectLanguage,
  settings,
  onChange,
}: {
  tracks: SubtitleTrack[];
  selectedLanguage: string | null;
  onSelectLanguage: (language: string | null) => void;
  settings: SubtitleSettings;
  onChange: (settings: SubtitleSettings) => void;
}) {
  function set<K extends keyof SubtitleSettings>(key: K, value: SubtitleSettings[K]) {
    onChange({ ...settings, [key]: value });
  }

  return (
    <div className="w-80 max-w-[90vw] rounded-2xl border border-white/10 bg-[#0b0b12]/95 p-4 shadow-2xl backdrop-blur">
      <div className={rowClass}>
        <span className={labelClass}>Subtitles</span>
        <select
          className={selectClass}
          value={selectedLanguage ?? ""}
          onChange={(e) => onSelectLanguage(e.target.value || null)}
        >
          <option value="">Off</option>
          {tracks.map((t) => (
            <option key={t.language} value={t.language}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {selectedLanguage && (
        <div className="mt-4 flex flex-col gap-4 border-t border-white/10 pt-4">
          <div className={rowClass}>
            <span className={labelClass}>Font</span>
            <select
              className={selectClass}
              value={settings.fontFamily}
              onChange={(e) => set("fontFamily", e.target.value)}
            >
              {FONT_OPTIONS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className={rowClass}>
              <span className={labelClass}>Size {settings.fontSize}px</span>
              <input
                type="range"
                min={14}
                max={40}
                value={settings.fontSize}
                onChange={(e) => set("fontSize", Number(e.target.value))}
                className={rangeClass}
              />
            </div>
            <div className={rowClass}>
              <span className={labelClass}>Weight</span>
              <select
                className={selectClass}
                value={settings.fontWeight}
                onChange={(e) => set("fontWeight", Number(e.target.value))}
              >
                <option value={400}>Regular</option>
                <option value={500}>Medium</option>
                <option value={700}>Bold</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className={rowClass}>
              <span className={labelClass}>Text color</span>
              <input
                type="color"
                value={settings.color}
                onChange={(e) => set("color", e.target.value)}
                className="h-9 w-full cursor-pointer rounded-lg border border-white/10 bg-transparent"
              />
            </div>
            <div className={rowClass}>
              <span className={labelClass}>Background</span>
              <input
                type="color"
                value={settings.backgroundColor}
                onChange={(e) => set("backgroundColor", e.target.value)}
                className="h-9 w-full cursor-pointer rounded-lg border border-white/10 bg-transparent"
              />
            </div>
          </div>

          <div className={rowClass}>
            <span className={labelClass}>Background opacity {Math.round(settings.backgroundOpacity * 100)}%</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.backgroundOpacity}
              onChange={(e) => set("backgroundOpacity", Number(e.target.value))}
              className={rangeClass}
            />
          </div>

          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm text-white/70">
              <input
                type="checkbox"
                checked={settings.outline}
                onChange={(e) => set("outline", e.target.checked)}
              />
              Outline
            </label>
            <label className="flex items-center gap-2 text-sm text-white/70">
              <input
                type="checkbox"
                checked={settings.shadow}
                onChange={(e) => set("shadow", e.target.checked)}
              />
              Shadow
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className={rowClass}>
              <span className={labelClass}>Position</span>
              <select
                className={selectClass}
                value={settings.position}
                onChange={(e) => set("position", e.target.value as SubtitleSettings["position"])}
              >
                <option value="bottom">Bottom</option>
                <option value="top">Top</option>
              </select>
            </div>
            <div className={rowClass}>
              <span className={labelClass}>Alignment</span>
              <select
                className={selectClass}
                value={settings.align}
                onChange={(e) => set("align", e.target.value as SubtitleSettings["align"])}
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </div>
          </div>

          <div className={rowClass}>
            <span className={labelClass}>Timing offset {settings.offsetSeconds.toFixed(1)}s</span>
            <input
              type="range"
              min={-10}
              max={10}
              step={0.1}
              value={settings.offsetSeconds}
              onChange={(e) => set("offsetSeconds", Number(e.target.value))}
              className={rangeClass}
            />
          </div>
        </div>
      )}
    </div>
  );
}
