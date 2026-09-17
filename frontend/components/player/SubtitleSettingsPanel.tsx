"use client";

import { FONT_OPTIONS, type SubtitleSettings } from "@/components/player/subtitle-settings";
import type { SubtitleTrack } from "@/lib/playback";

const labelClass = "text-[11px] font-medium uppercase tracking-wider text-white/40";
const selectClass =
  "w-full appearance-none rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white outline-none focus:border-[#FF5FA2]/60";
const rangeClass = "w-full accent-[#FF5FA2]";

const TEXT_COLOR_PRESETS = ["#ffffff", "#FFE066", "#8fe3c7", "#c9a6ff", "#FF5FA2"];
const BG_COLOR_PRESETS = ["#000000", "#0b0b12", "#2b2b2b", "#ffffff"];

// A small round swatch picker: a handful of one-click presets, plus a
// dashed "custom" swatch that hides a native color input underneath it —
// looks like a normal swatch button, but tapping it opens the OS color
// picker. Keeps the common cases one tap away without the raw <input
// type="color"> browser chrome sitting in the layout.
function ColorSwatchRow({
  value,
  onChange,
  presets,
}: {
  value: string;
  onChange: (v: string) => void;
  presets: string[];
}) {
  const isCustom = !presets.some((p) => p.toLowerCase() === value.toLowerCase());
  return (
    <div className="flex items-center gap-2">
      {presets.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`Use ${c}`}
          onClick={() => onChange(c)}
          className={`h-7 w-7 shrink-0 rounded-full border-2 transition-all hover:scale-110 ${
            !isCustom && value.toLowerCase() === c.toLowerCase()
              ? "border-[#FF5FA2] scale-110"
              : "border-white/15"
          }`}
          style={{ backgroundColor: c }}
        />
      ))}
      <label
        className={`relative flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 text-[13px] leading-none transition-all hover:scale-110 ${
          isCustom ? "border-[#FF5FA2] scale-110 text-white" : "border-dashed border-white/25 text-white/50 hover:text-white/80"
        }`}
        style={isCustom ? { backgroundColor: value } : undefined}
        title="Custom color"
      >
        {!isCustom && "+"}
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label="Custom color"
        />
      </label>
    </div>
  );
}

// A pill-shaped multi-way toggle — replaces plain <select> dropdowns for
// short, fixed option sets (weight, position, alignment), which reads as
// tidier and more deliberate than native select chrome for 2-3 choices.
function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex min-w-0 gap-0.5 rounded-lg bg-white/[0.06] p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`min-w-0 flex-1 truncate rounded-md px-1.5 py-1.5 text-xs font-medium transition-colors ${
            value === o.value ? "bg-[#FF5FA2] text-[#0b0b12]" : "text-white/60 hover:text-white"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex flex-1 items-center justify-between gap-2 rounded-lg bg-white/[0.06] px-3 py-2"
    >
      <span className="text-xs font-medium text-white/70">{label}</span>
      <span
        className={`relative inline-flex h-4 w-7 shrink-0 rounded-full transition-colors ${
          checked ? "bg-[#FF5FA2]" : "bg-white/20"
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${
            checked ? "translate-x-3" : "translate-x-0"
          }`}
        />
      </span>
    </button>
  );
}

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
    <div className="w-80 max-w-[90vw] overflow-hidden rounded-2xl border border-white/10 bg-[#0b0b12]/95 shadow-2xl backdrop-blur">
      <div className="flex flex-col gap-1.5 border-b border-white/10 p-4">
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
        <div className="flex max-h-[60vh] flex-col gap-5 overflow-y-auto p-4">
          {/* Live preview, so a change is visible immediately without
              hunting for it under this panel on the actual video. */}
          <div className="flex items-center justify-center rounded-xl border border-white/10 bg-black/50 px-3 py-6">
            <span
              style={{
                fontFamily: settings.fontFamily,
                fontSize: Math.min(settings.fontSize, 22),
                fontWeight: settings.fontWeight,
                color: settings.color,
                backgroundColor: settings.backgroundColor,
                opacity: 1,
                textShadow: settings.shadow ? "0 2px 6px rgba(0,0,0,0.8)" : undefined,
                WebkitTextStroke: settings.outline ? "0.6px rgba(0,0,0,0.8)" : undefined,
                padding: "0.15em 0.4em",
                borderRadius: "0.2em",
                boxDecorationBreak: "clone",
                WebkitBoxDecorationBreak: "clone",
              }}
            >
              Sample subtitle
            </span>
          </div>

          <div className="flex flex-col gap-3">
            <span className={labelClass}>Text</span>
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
            <div className="flex flex-col gap-1">
              <span className="text-xs text-white/50">Weight</span>
              <SegmentedControl
                value={String(settings.fontWeight)}
                onChange={(v) => set("fontWeight", Number(v))}
                options={[
                  { value: "400", label: "Regular" },
                  { value: "500", label: "Medium" },
                  { value: "700", label: "Bold" },
                ]}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-white/50">Size — {settings.fontSize}px</span>
              <input
                type="range"
                min={14}
                max={40}
                value={settings.fontSize}
                onChange={(e) => set("fontSize", Number(e.target.value))}
                className={rangeClass}
              />
            </div>
            <ColorSwatchRow value={settings.color} onChange={(v) => set("color", v)} presets={TEXT_COLOR_PRESETS} />
          </div>

          <div className="h-px bg-white/10" />

          <div className="flex flex-col gap-3">
            <span className={labelClass}>Background</span>
            <ColorSwatchRow
              value={settings.backgroundColor}
              onChange={(v) => set("backgroundColor", v)}
              presets={BG_COLOR_PRESETS}
            />
            <div className="flex flex-col gap-1">
              <span className="text-xs text-white/50">
                Opacity — {Math.round(settings.backgroundOpacity * 100)}%
              </span>
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
          </div>

          <div className="h-px bg-white/10" />

          <div className="flex flex-col gap-3">
            <span className={labelClass}>Position &amp; style</span>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-white/50">Position</span>
              <SegmentedControl
                value={settings.position}
                onChange={(v) => set("position", v)}
                options={[
                  { value: "bottom", label: "Bottom" },
                  { value: "top", label: "Top" },
                ]}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-white/50">Alignment</span>
              <SegmentedControl
                value={settings.align}
                onChange={(v) => set("align", v)}
                options={[
                  { value: "left", label: "Left" },
                  { value: "center", label: "Center" },
                  { value: "right", label: "Right" },
                ]}
              />
            </div>
            <div className="flex gap-2">
              <Toggle checked={settings.outline} onChange={(v) => set("outline", v)} label="Outline" />
              <Toggle checked={settings.shadow} onChange={(v) => set("shadow", v)} label="Shadow" />
            </div>
          </div>

          <div className="h-px bg-white/10" />

          <div className="flex flex-col gap-1">
            <span className={labelClass}>Timing offset — {settings.offsetSeconds.toFixed(1)}s</span>
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
