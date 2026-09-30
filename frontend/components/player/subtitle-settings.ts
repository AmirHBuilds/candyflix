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

const STORAGE_KEY = "candyflix:subtitle-settings";

export function loadSubtitleSettings(): SubtitleSettings {
  if (typeof window === "undefined") return DEFAULT_SUBTITLE_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SUBTITLE_SETTINGS;
    const parsed = JSON.parse(raw);
    const merged = { ...DEFAULT_SUBTITLE_SETTINGS, ...parsed };
    // Not a range check (any finite number is valid) — just refuses
    // junk from hand-edited/corrupt storage so the overlay can't get NaN.
    if (typeof merged.offsetSeconds !== "number" || !Number.isFinite(merged.offsetSeconds)) {
      merged.offsetSeconds = DEFAULT_SUBTITLE_SETTINGS.offsetSeconds;
    }
    return merged;
  } catch {
    return DEFAULT_SUBTITLE_SETTINGS;
  }
}

export function saveSubtitleSettings(settings: SubtitleSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage full/unavailable — settings just won't persist this time.
  }
}
