import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import postcss from "postcss";
import { THEMES } from "@/lib/themes";
import { appearanceAttributes, themeCanvas } from "@/lib/appearance";
import { DEFAULT_SETTINGS } from "@/lib/settings";

const root = join(__dirname, "..");
const css = readFileSync(join(root, "app/globals.css"), "utf8");

/** The `--color-*` declarations inside one block of globals.css. */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  expect(start, `${selector} block exists`).toBeGreaterThan(-1);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--color-([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2].toLowerCase()]));
}

describe("globals.css", () => {
  it("is valid CSS (a stray */ inside a comment once silently broke every rule after it)", () => {
    const root = postcss.parse(css);
    const selectors = root.nodes.filter((n) => n.type === "rule").map((n) => (n as postcss.Rule).selector);
    expect(selectors).toContain('html[data-theme="midnight"]');
    expect(selectors).toContain("body");
  });
});

describe("themes", () => {
  it("offers the six palettes, with Candy at Night first and default", () => {
    expect(THEMES.map((t) => t.id)).toEqual(["candy-at-night", "midnight", "mint", "lilac", "sunset", "mono"]);
    expect(DEFAULT_SETTINGS.appearance.theme).toBe("candy-at-night");
    expect(THEMES[0].label).toBe("Candy at Night");
  });

  it.each(THEMES.map((t) => [t.id, t] as const))("%s: the swatches match the real CSS values", (id, theme) => {
    const real = tokens(id === "candy-at-night" ? "@theme {" : `html[data-theme="${id}"]`);
    expect(real.canvas).toBe(theme.colors.canvas);
    expect(real.surface).toBe(theme.colors.surface);
    expect(real.accent).toBe(theme.colors.accent);
    expect(real.secondary).toBe(theme.colors.secondary);
    expect(real.highlight).toBe(theme.colors.highlight);
  });

  it("every theme defines every token (so none inherits a colour that clashes)", () => {
    const names = Object.keys(tokens("@theme {")).sort();
    expect(names).toEqual(["accent", "accent-hover", "canvas", "highlight", "on-accent", "secondary", "surface", "surface-deep"]);
    for (const t of THEMES.slice(1)) {
      expect(Object.keys(tokens(`html[data-theme="${t.id}"]`)).sort()).toEqual(names);
    }
  });

  it("text on the accent colour stays readable in every theme", () => {
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    for (const t of THEMES) {
      const real = tokens(t.id === "candy-at-night" ? "@theme {" : `html[data-theme="${t.id}"]`);
      const [hi, lo] = [lum(real.accent), lum(real["on-accent"])].sort((x, y) => y - x);
      expect((hi + 0.05) / (lo + 0.05), t.id).toBeGreaterThan(4.5);
    }
  });
});

describe("appearance attributes", () => {
  it("maps settings onto the html attributes", () => {
    expect(appearanceAttributes({ ...DEFAULT_SETTINGS.appearance, theme: "mint", text_size: "large", reduce_motion: "on" })).toEqual({
      "data-theme": "mint",
      "data-text-size": "large",
      "data-motion": "on",
    });
  });
  it("knows each theme's canvas for the browser's address bar", () => {
    expect(themeCanvas("midnight")).toBe("#080d1a");
    expect(themeCanvas("nonsense")).toBe("#0b0b12");
  });
});

// The reason themes work at all: no screen may hard-code a palette colour.
describe("colour-token guard", () => {
  const files: string[] = [];
  (function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(tsx?|css)$/.test(name) && !name.endsWith("globals.css")) files.push(full);
    }
  })(join(root, "app"));
  (function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name)) files.push(full);
    }
  })(join(root, "components"));

  // Colours that are deliberately fixed: avatar colours on the sign-in
  // screen and the subtitle colour pickers (user content, not chrome).
  const ALLOWED = new Set(["app/login/page.tsx", "components/player/SubtitleSettingsPanel.tsx", "components/player/subtitle-settings.ts"]);
  const PALETTE = /#(ff5fa2|0b0b12|8fe3c7|c9a6ff|14141f|0e0e17|15151f|ff85b8)\b/i;

  it("no component hard-codes a palette colour (use bg-canvas, text-accent, ...)", () => {
    const offenders = files
      .map((f) => f.slice(root.length + 1))
      .filter((rel) => !ALLOWED.has(rel))
      .filter((rel) => PALETTE.test(readFileSync(join(root, rel), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the page background and card glow follow the theme", () => {
    expect(readFileSync(join(root, "components/MediaCard.tsx"), "utf8")).toContain("var(--color-accent)");
    expect(readFileSync(join(root, "app/layout.tsx"), "utf8")).toContain("bg-canvas");
  });
});
