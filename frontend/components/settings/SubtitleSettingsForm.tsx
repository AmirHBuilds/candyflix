"use client";

import { useEffect, useState } from "react";
import { BG_COLOR_PRESETS, ColorSwatchRow, TEXT_COLOR_PRESETS } from "@/components/player/SubtitleSettingsPanel";
import { FONT_OPTIONS } from "@/components/player/subtitle-settings";
import { SegmentedControl, SettingRow, SettingsCard, Toggle } from "@/components/settings/controls";
import { useSettings } from "@/components/SettingsProvider";
import DEFAULTS from "@/lib/settings-defaults.json";
import type { Settings } from "@/lib/settings";

const selectClass =
  "h-10 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-sm text-white outline-none focus:border-accent/60";

const WEIGHTS = [
  { value: 400, label: "Regular" },
  { value: 500, label: "Medium" },
  { value: 700, label: "Bold" },
];

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  if (Number.isNaN(n)) return `rgba(0,0,0,${alpha})`;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** A slider that previews while dragging and saves once you let go. */
function RangeRow({
  id,
  label,
  description,
  value,
  min,
  max,
  step,
  format,
  onCommit,
}: {
  id: string;
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => draft !== value && onCommit(draft);
  return (
    <SettingRow label={label} htmlFor={id} description={description}>
      <div className="flex items-center gap-3">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={draft}
          onChange={(e) => setDraft(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
          className="w-40 accent-accent"
        />
        <span className="w-12 text-right text-sm tabular-nums text-white/60">{format(draft)}</span>
      </div>
    </SettingRow>
  );
}

export default function SubtitleSettingsForm() {
  const { settings, update } = useSettings();
  const s = settings.subtitles;
  const set = (patch: Partial<Settings["subtitles"]>) => update({ subtitles: patch });
  const [confirming, setConfirming] = useState(false);

  return (
    <SettingsCard
      title="Subtitle style"
      description="How subtitles look in every video. A change made inside the player only applies to that one video."
    >
      <div className="flex items-center justify-center bg-black/60 px-4 py-10" aria-label="Preview">
        <span
          data-testid="subtitle-preview"
          style={{
            fontFamily: s.font_family,
            fontSize: s.font_size,
            fontWeight: s.font_weight,
            color: s.color,
            backgroundColor: hexToRgba(s.background_color, s.background_opacity),
            textShadow: s.shadow ? "0 2px 8px rgba(0,0,0,0.85)" : undefined,
            WebkitTextStroke: s.outline ? `1px ${s.outline_color}` : undefined,
            padding: "0.25em 0.6em",
            borderRadius: 6,
            textAlign: s.align,
          }}
        >
          This is how your subtitles look.
        </span>
      </div>

      <SettingRow label="Font" htmlFor="sub-font">
        <select id="sub-font" value={s.font_family} onChange={(e) => set({ font_family: e.target.value })} className={selectClass}>
          {FONT_OPTIONS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow label="Weight">
        <SegmentedControl label="Weight" value={s.font_weight} options={WEIGHTS} onChange={(font_weight) => set({ font_weight })} />
      </SettingRow>
      <RangeRow id="sub-size" label="Size" value={s.font_size} min={14} max={48} step={1} format={(v) => `${v}px`} onCommit={(font_size) => set({ font_size })} />
      <SettingRow label="Text colour">
        <ColorSwatchRow value={s.color} onChange={(color) => set({ color })} presets={TEXT_COLOR_PRESETS} />
      </SettingRow>
      <SettingRow label="Background colour">
        <ColorSwatchRow value={s.background_color} onChange={(background_color) => set({ background_color })} presets={BG_COLOR_PRESETS} />
      </SettingRow>
      <RangeRow
        id="sub-bg-opacity"
        label="Background opacity"
        value={Math.round(s.background_opacity * 100)}
        min={0}
        max={100}
        step={5}
        format={(v) => `${v}%`}
        onCommit={(v) => set({ background_opacity: v / 100 })}
      />
      <SettingRow label="Outline" htmlFor="sub-outline" description="A thin dark edge around each letter.">
        <Toggle id="sub-outline" label="Outline" checked={s.outline} onChange={(outline) => set({ outline })} />
      </SettingRow>
      <SettingRow label="Shadow" htmlFor="sub-shadow">
        <Toggle id="sub-shadow" label="Shadow" checked={s.shadow} onChange={(shadow) => set({ shadow })} />
      </SettingRow>
      <SettingRow label="Position">
        <SegmentedControl
          label="Position"
          value={s.position}
          options={[
            { value: "bottom", label: "Bottom" },
            { value: "top", label: "Top" },
          ]}
          onChange={(position) => set({ position })}
        />
      </SettingRow>
      <SettingRow label="Alignment">
        <SegmentedControl
          label="Alignment"
          value={s.align}
          options={[
            { value: "left", label: "Left" },
            { value: "center", label: "Centre" },
            { value: "right", label: "Right" },
          ]}
          onChange={(align) => set({ align })}
        />
      </SettingRow>
      <SettingRow
        label="Back to the standard look"
        description="Puts the style above back to its defaults. Like any change here, it also replaces what individual videos had saved for these settings."
      >
        {confirming ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                update({ subtitles: Object.fromEntries(Object.keys(DEFAULTS.subtitles).map((k) => [k, null])) as never });
                setConfirming(false);
              }}
              className="h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent/90"
            >
              Yes, reset the style
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="h-10 rounded-xl bg-white/10 px-4 text-sm font-medium text-white/80 hover:bg-white/15">
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className="h-10 rounded-xl bg-white/10 px-4 text-sm font-medium text-white/80 hover:bg-white/15">
            Reset style
          </button>
        )}
      </SettingRow>
    </SettingsCard>
  );
}
