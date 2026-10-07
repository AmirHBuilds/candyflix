"use client";

import { useEffect, useRef, useState } from "react";
import Flag from "@/components/player/Flag";
import OffsetStepper from "@/components/player/OffsetStepper";
import OpenSubtitlesBrowser from "@/components/player/OpenSubtitlesBrowser";
import SubtitleRow, { centerInScrollArea } from "@/components/player/SubtitleRow";
import SyncSubtitleControl from "@/components/player/SyncSubtitleControl";
import { FONT_OPTIONS, type SubtitleSettings } from "@/components/player/subtitle-settings";
import type { WatchIdentity } from "@/components/player/useWatchProgress";
import type { SubtitleTrack } from "@/lib/playback";

const labelClass = "text-[11px] font-medium uppercase tracking-wider text-white/40";
const selectClass =
  "w-full appearance-none rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white outline-none focus:border-accent/60";
const rangeClass = "w-full accent-accent";

export const TEXT_COLOR_PRESETS = ["#ffffff", "#FFE066", "#8fe3c7", "#c9a6ff", "#FF5FA2"];
export const BG_COLOR_PRESETS = ["#000000", "#0b0b12", "#2b2b2b", "#ffffff"];

// A small round swatch picker: a handful of one-click presets, plus a
// dashed "custom" swatch that hides a native color input underneath it —
// looks like a normal swatch button, but tapping it opens the OS color
// picker. Keeps the common cases one tap away without the raw <input
// type="color"> browser chrome sitting in the layout.
export function ColorSwatchRow({
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
              ? "border-accent scale-110"
              : "border-white/15"
          }`}
          style={{ backgroundColor: c }}
        />
      ))}
      <label
        className={`relative flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 text-[13px] leading-none transition-all hover:scale-110 ${
          isCustom ? "border-accent scale-110 text-white" : "border-dashed border-white/25 text-white/50 hover:text-white/80"
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
            value === o.value ? "bg-accent text-on-accent" : "text-white/60 hover:text-white"
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
          checked ? "bg-accent" : "bg-white/20"
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

type TabId = "source" | "opensubtitles" | "synced" | "style";

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl bg-white/[0.04] p-4 text-center text-sm leading-relaxed text-white/50">{children}</p>;
}

export default function SubtitleSettingsPanel({
  tracks,
  listedTracks,
  selectedLanguage,
  onSelectLanguage,
  settings,
  onChange,
  identity,
  onTrackAdded,
}: {
  // The track actually used for each language (what plays).
  tracks: SubtitleTrack[];
  // Every track the video has been offered, for the Source and Synced tabs.
  listedTracks: SubtitleTrack[];
  selectedLanguage: string | null;
  onSelectLanguage: (language: string | null) => void;
  settings: SubtitleSettings;
  onChange: (settings: SubtitleSettings) => void;
  identity: WatchIdentity;
  onTrackAdded: (track: SubtitleTrack) => void;
}) {
  const active = selectedLanguage ? tracks.find((t) => t.language === selectedLanguage) : undefined;
  const sourceTracks = listedTracks.filter((t) => !t.synced && t.origin === "source");
  const syncedTracks = listedTracks.filter((t) => t.synced);

  const [tab, setTab] = useState<TabId>(() => {
    if (active?.synced) return "synced";
    if (active) return active.origin === "source" ? "source" : "opensubtitles";
    return sourceTracks.length > 0 ? "source" : "opensubtitles";
  });
  // The OpenSubtitles tab is only built once it's been opened (it makes a request),
  // and stays built afterwards so switching tabs doesn't lose the search.
  const [osOpened, setOsOpened] = useState(tab === "opensubtitles");

  // Switching tabs: show the subtitle in use if this tab lists it.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const row = scrollRef.current?.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden]) [aria-current="true"]');
      if (row) centerInScrollArea(row);
    });
    return () => cancelAnimationFrame(id);
  }, [tab]);

  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: "source", label: "Source", count: sourceTracks.length },
    { id: "opensubtitles", label: "OpenSubtitles" },
    ...(syncedTracks.length > 0 ? [{ id: "synced" as const, label: "Synced", count: syncedTracks.length }] : []),
    { id: "style", label: "Style" },
  ];

  function choose(track: SubtitleTrack) {
    onTrackAdded(track);
  }

  function set<K extends keyof SubtitleSettings>(key: K, value: SubtitleSettings[K]) {
    onChange({ ...settings, [key]: value });
  }

  return (
    <div
      role="dialog"
      aria-label="Subtitles"
      className="flex max-h-[min(72dvh,30rem)] w-[26rem] max-w-[94vw] flex-col overflow-hidden rounded-2xl border border-white/10 bg-canvas/95 shadow-2xl backdrop-blur"
    >
      {/* What's showing now, with the quick actions for it. */}
      <div className="flex shrink-0 flex-col gap-2.5 border-b border-white/10 p-3">
        <div className="flex items-center gap-3">
          <Flag language={active?.language ?? null} size="md" />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium uppercase tracking-wider text-white/40">Subtitles</div>
            <div className="truncate text-sm font-semibold text-white">
              {active ? active.label : "Off"}
              {active?.synced && <span className="ml-2 text-xs font-medium text-accent">synced</span>}
            </div>
          </div>
          {active ? (
            <button
              type="button"
              onClick={() => onSelectLanguage(null)}
              className="shrink-0 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white/80 transition-colors hover:bg-white/20 hover:text-white"
            >
              Turn off
            </button>
          ) : null}
        </div>
        {active && !active.synced && <SyncSubtitleControl track={active} identity={identity} onSynced={choose} />}
        {active?.synced && <p className="text-xs text-white/50">Matched to this video&apos;s audio ✓</p>}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {/* Tabs: one compact row across the top. */}
        <div
          role="tablist"
          aria-label="Subtitle sources"
          className="flex shrink-0 gap-1 border-b border-white/10 p-1.5"
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`subtab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`subpanel-${t.id}`}
              onClick={() => {
                setTab(t.id);
                if (t.id === "opensubtitles") setOsOpened(true);
              }}
              className={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1.5 text-[13px] font-medium transition-colors ${
                tab === t.id ? "bg-accent text-on-accent" : "text-white/65 hover:bg-white/10 hover:text-white"
              }`}
            >
              {t.label}
              {t.count != null && t.count > 0 && (
                <span className={`rounded-full px-1.5 text-[11px] ${tab === t.id ? "bg-black/15" : "bg-white/10 text-white/60"}`}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        <div ref={scrollRef} data-scroll-area className="min-h-0 min-w-0 flex-1 overflow-y-auto p-3">
          <div role="tabpanel" id="subpanel-source" aria-labelledby="subtab-source" hidden={tab !== "source"} className="flex flex-col gap-1.5">
            {sourceTracks.length === 0 ? (
              <EmptyNote>
                This video doesn&apos;t come with subtitles of its own. Look in the OpenSubtitles tab.
              </EmptyNote>
            ) : (
              sourceTracks.map((t) => (
                <SubtitleRow
                  key={t.url}
                  language={t.language}
                  title={t.label}
                  detail="Comes with the video"
                  active={active?.url === t.url}
                  onClick={() => choose(t)}
                />
              ))
            )}
          </div>

          <div
            role="tabpanel"
            id="subpanel-opensubtitles"
            aria-labelledby="subtab-opensubtitles"
            hidden={tab !== "opensubtitles"}
          >
            {osOpened && <OpenSubtitlesBrowser identity={identity} activeUrl={active?.url ?? null} onPicked={choose} />}
          </div>

          {syncedTracks.length > 0 && (
            <div role="tabpanel" id="subpanel-synced" aria-labelledby="subtab-synced" hidden={tab !== "synced"} className="flex flex-col gap-1.5">
              {syncedTracks.map((t) => (
                <SubtitleRow
                  key={t.url}
                  language={t.language}
                  title={t.label}
                  detail="Re-timed to this video"
                  active={active?.url === t.url}
                  onClick={() => choose(t)}
                />
              ))}
            </div>
          )}

          <div role="tabpanel" id="subpanel-style" aria-labelledby="subtab-style" hidden={tab !== "style"} className="flex flex-col gap-5">
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

          <div className="flex flex-col gap-2">
            <span className={labelClass}>Timing offset</span>
            <OffsetStepper value={settings.offsetSeconds} onChange={(v) => set("offsetSeconds", v)} />
          </div>

            <div className="h-px bg-white/10" />

            <p className="text-[11px] leading-snug text-white/40">
              The look applies to every video (also in Settings → Subtitles). Language and timing are for this video only.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
