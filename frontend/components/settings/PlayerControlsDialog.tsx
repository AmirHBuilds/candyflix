"use client";

import type { ReactNode } from "react";
import Dialog from "@/components/admin/Dialog";
import { CONTROLS, SWITCHABLE, type ControlId } from "@/components/player/controls";
import {
  BackIcon,
  CCIcon,
  ForwardIcon,
  FullscreenIcon,
  GearIcon,
  NextIcon,
  PipIcon,
  AssistantIcon,
  PlayIcon,
  PrevIcon,
  VolumeHighIcon,
} from "@/components/player/icons";
import { useSettings } from "@/components/SettingsProvider";
import { Toggle } from "@/components/settings/controls";

export const PLAYER_PREVIEW_IMAGE = "/images/player-preview.png";

/**
 * Choose which buttons the player shows. The mock-up bar sits on a
 * placeholder frame and mirrors the real bar's order: tap a button to
 * remove it; bring it back with its switch in the list below. Play/Pause and Settings can't be removed.
 */
export default function PlayerControlsDialog({ onClose }: { onClose: () => void }) {
  const { settings, update } = useSettings();
  const controls = settings.playback.controls;
  const set = (id: ControlId, value: boolean) => update({ playback: { controls: { [id]: value } } });

  // One button of the preview: looks like the real one. Tap to remove; a removed button stays as a
  // dotted ghost to tap again. Play and Settings are locked.
  function Btn({ id, children, round = true }: { id: (typeof CONTROLS)[number]["id"]; children: ReactNode; round?: boolean }) {
    const info = CONTROLS.find((c) => c.id === id)!;
    const on = info.locked ? true : controls[id as ControlId];
    if (!on) return null; // a switched-off button simply isn't in the preview; the list below brings it back
    return (
      <button
        type="button"
        disabled={info.locked}
        onClick={() => set(id as ControlId, false)}
        aria-label={`Remove ${info.label} ${info.locked ? "(always shown)" : "button"}`}
        title={info.locked ? `${info.label}: always shown` : `Remove ${info.label}`}
        className={`flex h-8 items-center justify-center text-white transition-all sm:h-9 ${round ? "w-8 rounded-full sm:w-9" : "rounded-full px-3 text-sm font-medium tabular-nums"} ${
          info.locked ? "opacity-100" : "text-white/90 hover:bg-white/20"
        }`}
      >
        {children}
      </button>
    );
  }
  const pill = "flex items-center gap-0.5 rounded-full bg-white/15 p-1";
  const showPill = (...ids: ControlId[]) => ids.some((id) => controls[id]);

  return (
    <Dialog title="Customise player buttons" onClose={onClose} wide>
      <div className="space-y-5">
        <p className="text-sm text-white/60">
          This is your player. Tap a button to remove it; switch it back on in the list below. A removed button&apos;s keyboard shortcut stops working too.
        </p>

        <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-white/10 bg-black" data-testid="player-mockup">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={PLAYER_PREVIEW_IMAGE} alt="" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-3 pb-3 pt-14 sm:px-5 sm:pb-4">
            {/* the progress bar, as in the player */}
            <div className="relative mb-3 h-1 w-full rounded-full bg-white/25">
              <div className="absolute left-0 top-0 h-full w-[27%] rounded-full bg-accent">
                <div className="absolute -right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-accent" />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-white">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 sm:h-10 sm:w-10">
                <Btn id="play"><PlayIcon /></Btn>
              </div>
              {showPill("seek_back", "seek_forward") && (
                <div className={pill}>
                  <Btn id="seek_back"><BackIcon /></Btn>
                  <Btn id="seek_forward"><ForwardIcon /></Btn>
                </div>
              )}
              {showPill("episodes") && (
                <div className={pill}>
                  <Btn id="episodes" round={false}>
                    <PrevIcon />
                    <span className="w-1" />
                    <NextIcon />
                  </Btn>
                </div>
              )}
              {showPill("volume") && (
                <div className={`${pill} pr-3`}>
                  <Btn id="volume"><VolumeHighIcon /></Btn>
                  <span className="h-1 w-16 rounded-full bg-white/30">
                    <span className="block h-full w-2/3 rounded-full bg-accent" />
                  </span>
                </div>
              )}
              {showPill("time") && (
                <div className={pill}>
                  <Btn id="time" round={false}>12:03 / 45:10</Btn>
                </div>
              )}
              <div className={`${pill} ml-auto`}>
                <Btn id="assistant"><AssistantIcon /></Btn>
                <Btn id="captions"><CCIcon active={false} /></Btn>
                <Btn id="settings"><GearIcon /></Btn>
                <Btn id="pip"><PipIcon /></Btn>
                <Btn id="fullscreen"><FullscreenIcon /></Btn>
              </div>
            </div>
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
