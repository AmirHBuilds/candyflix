import type { Theme } from "@/lib/settings";

/**
 * The palettes, for the picker's swatches. The real values live in
 * app/globals.css (`@theme` and `html[data-theme=...]`); a test checks the
 * two stay identical, so adding a theme means touching both.
 */
export type ThemeInfo = {
  id: Theme;
  label: string;
  colors: { canvas: string; surface: string; accent: string; secondary: string; highlight: string };
};

export const THEMES: ThemeInfo[] = [
  { id: "candy-at-night", label: "Candy at Night", colors: { canvas: "#0b0b12", surface: "#14141f", accent: "#ff5fa2", secondary: "#c9a6ff", highlight: "#8fe3c7" } },
  { id: "midnight", label: "Midnight", colors: { canvas: "#080d1a", surface: "#111b33", accent: "#5b9dff", secondary: "#a5b4ff", highlight: "#7ee0e8" } },
  { id: "mint", label: "Mint", colors: { canvas: "#08120f", surface: "#10211b", accent: "#3ddc97", secondary: "#9ed8ff", highlight: "#f5d76e" } },
  { id: "lilac", label: "Lilac", colors: { canvas: "#0e0a17", surface: "#1a1328", accent: "#b58cff", secondary: "#ff9ed2", highlight: "#8fe3c7" } },
  { id: "sunset", label: "Sunset", colors: { canvas: "#140a0a", surface: "#23140f", accent: "#ff8a3d", secondary: "#ff6b7a", highlight: "#ffd166" } },
  { id: "mono", label: "Mono", colors: { canvas: "#000000", surface: "#141414", accent: "#ffffff", secondary: "#bdbdbd", highlight: "#e5e5e5" } },
];
