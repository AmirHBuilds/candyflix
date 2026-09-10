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
  offsetSeconds: number; // + delays subtitles, - shows them earlier
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

const STORAGE_KEY = "candyflix:subtitle-settings";

export function loadSubtitleSettings(): SubtitleSettings {
  if (typeof window === "undefined") return DEFAULT_SUBTITLE_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SUBTITLE_SETTINGS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SUBTITLE_SETTINGS, ...parsed };
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
