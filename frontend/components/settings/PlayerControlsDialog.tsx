"use client";

import Dialog from "@/components/admin/Dialog";
import { CONTROLS, SWITCHABLE, type ControlId } from "@/components/player/controls";
import { useSettings } from "@/components/SettingsProvider";
import { Toggle } from "@/components/settings/controls";

export const PLAYER_PREVIEW_IMAGE = "/images/player-preview.png";

// What each button looks like in the little mock-up.
const GLYPHS: Record<string, string> = {
  play: "▶",
  seek_back: "↺",
  seek_forward: "↻",
  episodes: "⏮ ⏭",
  volume: "♪",
  time: "12:03 / 45:10",
  captions: "CC",
  settings: "⚙",
  pip: "PiP",
  fullscreen: "⛶",
};

/**
 * Choose which buttons the player shows. The mock-up bar sits on a
 * placeholder frame and mirrors the real bar's order: tap a button to
 * remove it; a removed one stays as a dotted ghost you can tap to bring
 * back. Play/Pause and Settings can't be removed.
 */
export default function PlayerControlsDialog({ onClose }: { onClose: () => void }) {
  const { settings, update } = useSettings();
  const controls = settings.playback.controls;
  const set = (id: ControlId, value: boolean) => update({ playback: { controls: { [id]: value } } });

  function MockButton({ id }: { id: (typeof CONTROLS)[number]["id"] }) {
    const info = CONTROLS.find((c) => c.id === id)!;
    const on = info.locked ? true : controls[id as ControlId];
    return (
      <button
        type="button"
        disabled={info.locked}
        onClick={() => set(id as ControlId, !on)}
        aria-label={`${on ? "Remove" : "Add"} ${info.label} ${info.locked ? "(always shown)" : "button"}`}
        title={info.locked ? `${info.label}: always shown` : `${on ? "Remove" : "Add"} ${info.label}`}
        className={`h-7 min-w-7 whitespace-nowrap rounded-full px-2 text-[11px] font-medium transition-colors ${
          info.locked
            ? "bg-white/25 text-white"
            : on
              ? "bg-white/20 text-white hover:bg-white/30"
              : "border border-dashed border-white/40 text-white/50 hover:text-white"
        }`}
      >
        {GLYPHS[id]}
      </button>
    );
  }

  return (
    <Dialog title="Customise player buttons" onClose={onClose}>
      <div className="space-y-5">
        <p className="text-sm text-white/60">
          Tap a button below to remove it from the player. Dotted ones are hidden — tap to bring them back. A removed button&apos;s keyboard shortcut stops working too.
        </p>

        <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-white/10 bg-black" data-testid="player-mockup">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={PLAYER_PREVIEW_IMAGE} alt="" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-1.5 bg-gradient-to-t from-black/90 to-transparent px-3 pb-2 pt-8">
            <MockButton id="play" />
            <MockButton id="seek_back" />
            <MockButton id="seek_forward" />
            <MockButton id="episodes" />
            <MockButton id="volume" />
            <MockButton id="time" />
            <span className="ml-auto flex items-center gap-1.5">
              <MockButton id="captions" />
              <MockButton id="settings" />
              <MockButton id="pip" />
              <MockButton id="fullscreen" />
            </span>
          </div>
        </div>

        <ul className="divide-y divide-white/10 rounded-xl border border-white/10">
          {CONTROLS.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-white">
                  {c.label}
                  {c.extra && <span className="ml-2 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-accent">Extra</span>}
                </p>
                <p className="text-xs text-white/50">
                  {[c.description, c.shortcuts.length ? `Shortcut: ${c.shortcuts.join(" · ")}` : ""].filter(Boolean).join(" ")}
                </p>
              </div>
              {c.locked ? (
                <span className="shrink-0 text-xs text-white/40">Always on</span>
              ) : (
                <Toggle label={c.label} checked={controls[c.id as ControlId]} onChange={(v) => set(c.id as ControlId, v)} />
              )}
            </li>
          ))}
        </ul>

        <div className="flex justify-between gap-2">
          <button
            type="button"
            onClick={() => update({ playback: { controls: Object.fromEntries(SWITCHABLE.map((c) => [c.id, null])) as never } })}
            className="h-10 rounded-xl bg-white/10 px-4 text-sm font-medium text-white/80 hover:bg-white/15"
          >
            Back to the standard buttons
          </button>
          <button type="button" onClick={onClose} className="h-10 rounded-xl bg-accent px-5 text-sm font-semibold text-on-accent hover:bg-accent/90">
            Done
          </button>
        </div>
      </div>
    </Dialog>
  );
}
