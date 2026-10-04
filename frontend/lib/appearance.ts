import type { Settings } from "@/lib/settings";
import { THEMES } from "@/lib/themes";

/**
 * The <html> attributes that carry the appearance settings. Written by the
 * root layout on the server (so the first paint is already right) and kept
 * up to date in the browser by SettingsProvider as settings change.
 */
export function appearanceAttributes(a: Settings["appearance"]) {
  return {
    "data-theme": a.theme,
    "data-text-size": a.text_size,
    "data-motion": a.reduce_motion,
  } as const;
}

export function themeCanvas(theme: string): string {
  return (THEMES.find((t) => t.id === theme) ?? THEMES[0]).colors.canvas;
}
