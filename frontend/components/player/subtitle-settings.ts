export type SubtitlePosition = "bottom" | "top";
export type SubtitleAlign = "left" | "center" | "right";

export type SubtitleSettings = {
  fontFamily: string;
  fontSize: number; // px
  fontWeight: number;
  color: string; // hex
  backgroundColor: string; // hex
  backgroundOpacity: number; // 0-1
  outline: boolean;
  outlineColor: string; // hex
  shadow: boolean;
  position: SubtitlePosition;
  align: SubtitleAlign;
  // + delays subtitles, - shows them earlier. Deliberately unbounded:
  // no min/max anywhere (UI, storage, or findActiveCue) — the person
  // can dial in as much correction as a badly-synced file needs.
  offsetSeconds: number;
};

export const DEFAULT_SUBTITLE_SETTINGS: SubtitleSettings = {
  fontFamily: "Inter, system-ui, sans-serif",
  fontSize: 22,
  fontWeight: 500,
  color: "#ffffff",
  backgroundColor: "#000000",
  backgroundOpacity: 0.6,
  outline: true,
  outlineColor: "#000000",
  shadow: true,
  position: "bottom",
  align: "center",
  offsetSeconds: 0,
};

export const FONT_OPTIONS = [
  { value: "Inter, system-ui, sans-serif", label: "Inter (default)" },
  { value: "Georgia, serif", label: "Georgia" },
  { value: "'Courier New', monospace", label: "Monospace" },
  { value: "Arial, sans-serif", label: "Arial" },
];

/** One click of the offset stepper. */
export const OFFSET_STEP_MS = 100;

/**
 * Moves the offset by `deltaMs`. Works in whole milliseconds so that
 * repeated steps can't accumulate float error (0.1 + 0.2 !== 0.3) —
 * the offset stays a plain number of seconds, but every step starts
 * from its rounded-to-the-ms value.
 */
export function stepOffsetSeconds(currentSeconds: number, deltaMs: number): number {
  return (Math.round(currentSeconds * 1000) + deltaMs) / 1000;
}

/** Display form: one decimal, explicit sign, unit — "-2.3 S", "+1.2 S", "0.0 S". */
export function formatOffset(seconds: number): string {
  const tenths = Math.round(Math.abs(seconds) * 10) / 10;
  if (tenths === 0) return "0.0 S"; // never "-0.0 S"
  return `${seconds < 0 ? "-" : "+"}${tenths.toFixed(1)} S`;
}

/** Full-precision form for the edit box, so opening it never loses digits: "1.25". */
export function formatOffsetForEditing(seconds: number): string {
  return String(Math.round(seconds * 1000) / 1000);
}

/**
 * Parses what the person typed, in seconds. Accepts a leading sign, a
 * decimal point or comma, and an optional trailing "s"/"S" ("-2.3",
 * "+1,5", "0.75 S"). More than 3 decimals is rounded to the nearest
 * millisecond. Returns null for anything else — the caller reverts.
 */
export function parseOffsetInput(text: string): number | null {
  const cleaned = text
    .trim()
    .replace(/\u2212/g, "-") // typographic minus
    .replace(/,/g, ".")
    .replace(/\s*s$/i, "")
    .trim();
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 1000) / 1000 || 0; // "|| 0" turns -0 into 0
}

// --- Global defaults (Settings → Subtitles) and per-video overrides ---------
//
// The look (font, colours, size, position…) is one setting for the whole
// site, kept on the server (settings.subtitles, snake_case) and changeable
// from the player or from Settings → Subtitles. Only the language and the
// timing offset belong to a single video (video_settings).

export type GlobalSubtitleStyle = import("@/lib/settings").Settings["subtitles"];

const STYLE_FIELDS = [
  ["font_family", "fontFamily"],
  ["font_size", "fontSize"],
  ["font_weight", "fontWeight"],
  ["color", "color"],
  ["background_color", "backgroundColor"],
  ["background_opacity", "backgroundOpacity"],
  ["outline", "outline"],
  ["outline_color", "outlineColor"],
  ["shadow", "shadow"],
  ["position", "position"],
  ["align", "align"],
] as const;

/** The person's defaults as the player's settings object (offset always starts at 0). */
export function fromGlobalStyle(global: GlobalSubtitleStyle): SubtitleSettings {
  const out: Record<string, unknown> = { offsetSeconds: 0 };
  for (const [snake, camel] of STYLE_FIELDS) out[camel] = global[snake];
  return out as SubtitleSettings;
}

/** The style keys that differ between two settings objects, as a global settings patch. */
export function stylePatch(prev: SubtitleSettings, next: SubtitleSettings): Partial<GlobalSubtitleStyle> {
  const patch: Record<string, unknown> = {};
  for (const [snake, camel] of STYLE_FIELDS) {
    if (prev[camel] !== next[camel]) patch[snake] = next[camel];
  }
  return patch as Partial<GlobalSubtitleStyle>;
}
