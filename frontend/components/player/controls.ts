/**
 * The player's control bar, as data (Phase 9g). One entry per button the
 * person can switch on or off in Settings → Playback → Customise buttons.
 * The player and the customiser both read this, so they can't disagree.
 *
 * Play/Pause and Settings are always shown (they're how you'd get anything
 * back), so they are listed as `locked`: visible in the customiser, never
 * switchable. A switched-off control also loses its keyboard shortcut.
 * Seeking with the arrow keys / J / L is always available.
 */
export type ControlId = "episodes" | "volume" | "time" | "captions" | "fullscreen" | "seek_back" | "seek_forward" | "pip";

export type ControlInfo = {
  id: ControlId | "play" | "settings";
  label: string;
  description: string;
  shortcuts: string[];
  locked?: boolean;
  /** Not in the bar until chosen. */
  extra?: boolean;
};

export const CONTROLS: ControlInfo[] = [
  { id: "play", label: "Play / Pause", description: "Always shown.", shortcuts: ["Space", "K"], locked: true },
  { id: "episodes", label: "Previous / next episode", description: "Only appears on series.", shortcuts: ["Shift+P", "Shift+N"] },
  { id: "volume", label: "Volume", description: "The speaker button and the slider.", shortcuts: ["M", "↑", "↓"] },
  { id: "time", label: "Time", description: "Where you are in the video.", shortcuts: [] },
  { id: "captions", label: "Subtitles button", description: "Turns subtitles on and off.", shortcuts: ["C"] },
  { id: "settings", label: "Settings", description: "Always shown.", shortcuts: ["S"], locked: true },
  { id: "fullscreen", label: "Fullscreen", description: "", shortcuts: ["F"] },
  { id: "seek_back", label: "Jump back", description: "Back by your seek time.", shortcuts: [], extra: true },
  { id: "seek_forward", label: "Jump forward", description: "Forward by your seek time.", shortcuts: [], extra: true },
  { id: "pip", label: "Picture in picture", description: "A small floating video. Only where the browser supports it.", shortcuts: ["P"], extra: true },
];

export const SWITCHABLE: ControlInfo[] = CONTROLS.filter((c) => !c.locked);
