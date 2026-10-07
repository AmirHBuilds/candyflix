import { getApiBaseUrl, fetchWithTimeout } from "@/lib/api-client";
import defaults from "@/lib/settings-defaults.json";

// Mirrors the backend's app/schemas/settings.py (snake_case, same keys).
// The defaults themselves live in settings-defaults.json, generated from
// the backend schema and checked against it by a backend test.

export type Theme = "candy-at-night" | "midnight" | "mint" | "lilac" | "sunset" | "mono";
export type SeekSeconds = 5 | 10 | 15 | 20 | 30;

export type Settings = {
  appearance: {
    theme: Theme;
    home_layout: "grid" | "rows";
    items_per_section: number;
    episode_view: "list" | "blocks";
    description_length: "short" | "standard" | "full";
    text_size: "small" | "default" | "large";
    reduce_motion: "auto" | "on" | "off";
    hero_enabled: boolean;
    hero_description: boolean;
    hero_interval_seconds: number;
    show_ratings: boolean;
    show_years: boolean;
  };
  playback: {
    autoplay_next: boolean;
    autoplay_on_open: boolean;
    auto_skip_intro: boolean;
    skip_buttons: { intro: boolean; recap: boolean; credits: boolean };
    seek_seconds: SeekSeconds;
    auto_subtitles: { enabled: boolean; language: string; fallback_language: string | null };
    save_progress: boolean;
    remember_per_video: boolean;
    controls: {
      episodes: boolean;
      volume: boolean;
      time: boolean;
      captions: boolean;
      fullscreen: boolean;
      seek_back: boolean;
      seek_forward: boolean;
      pip: boolean;
    };
  };
  subtitles: {
    font_family: string;
    font_size: number;
    font_weight: number;
    color: string;
    background_color: string;
    background_opacity: number;
    outline: boolean;
    outline_color: string;
    shadow: boolean;
    position: "bottom" | "top";
    align: "left" | "center" | "right";
  };
};

/** A partial change. A `null` leaf means "back to the default". */
export type SettingsPatch = {
  [G in keyof Settings]?: {
    [K in keyof Settings[G]]?: Settings[G][K] extends object | null
      ? { [S in keyof NonNullable<Settings[G][K]>]?: NonNullable<Settings[G][K]>[S] | null } | null
      : Settings[G][K] | null;
  };
};

export const DEFAULT_SETTINGS = defaults as Settings;

type Plain = { [key: string]: unknown };
const isPlain = (v: unknown): v is Plain => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Applies a patch the same way the server does (nested merge, `null` =
 * reset that key to its default), so the UI can show a change instantly
 * and then reconcile with the server's answer.
 */
export function applyPatch<T extends object>(current: T, patch: object, fallback: T): T {
  const out: Plain = { ...(current as Plain) };
  for (const [key, value] of Object.entries(patch as Plain)) {
    const base = (current as Plain)[key];
    const dflt = (fallback as Plain)[key];
    if (value === null) {
      out[key] = dflt;
    } else if (isPlain(value) && isPlain(base) && isPlain(dflt)) {
      out[key] = applyPatch(base, value, dflt);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

/** Thrown when the server refuses a change; `problems` are readable lines. */
export class SettingsError extends Error {
  constructor(public problems: string[]) {
    super(problems.join("; ") || "Couldn't save settings");
    this.name = "SettingsError";
  }
}

const url = () => `${getApiBaseUrl()}/settings`;

export async function getSettings(): Promise<Settings> {
  const res = await fetchWithTimeout(url(), { credentials: "include", cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load settings");
  return res.json();
}

export async function patchSettings(patch: SettingsPatch): Promise<Settings> {
  const res = await fetchWithTimeout(url(), {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (res.status === 422) {
    const body = await res.json().catch(() => ({}));
    throw new SettingsError(Array.isArray(body.detail) ? body.detail.map(String) : []);
  }
  if (!res.ok) throw new Error("Failed to save settings");
  return res.json();
}

export async function resetSettings(): Promise<Settings> {
  const res = await fetchWithTimeout(url(), { method: "DELETE", credentials: "include" });
  if (!res.ok) throw new Error("Failed to reset settings");
  return res.json();
}
