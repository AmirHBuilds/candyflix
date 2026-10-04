import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(tsx?|css)$/.test(name)) out.push(full);
  }
  return out;
}

const files = [...sourceFiles(join(root, "app")), ...sourceFiles(join(root, "components"))];

describe("mobile guards", () => {
  it("no plain vh / screen viewport-height units — they include the phone's address bar and jump as it collapses (use dvh)", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      // Only look at class-name-like usages, not prose in comments.
      for (const line of text.split("\n")) {
        if (/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line)) continue;
        if (/\b\d+vh\b/.test(line) || /\bmin-h-screen\b|\bh-screen\b/.test(line)) {
          offenders.push(`${relative(root, file)}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every 32px player button gets a 40px touch target on touch devices", () => {
    const player = read("components/player/VideoPlayer.tsx");
    const all = player.match(/h-8 w-8[^"`]*/g) ?? [];
    expect(all.length).toBeGreaterThanOrEqual(6);
    for (const cls of all) expect(cls).toContain("pointer-coarse:h-10 pointer-coarse:w-10");
  });

  it("the seek bar gets a taller invisible hit area on touch devices", () => {
    expect(read("components/player/VideoPlayer.tsx")).toContain("pointer-coarse:h-8");
  });

  it("the home skeleton's hero has the same height rules as the real hero (no jump on load)", () => {
    const hero = read("components/HeroCarousel.tsx");
    const skeleton = read("components/Skeleton.tsx");
    for (const cls of ["h-[75dvh]", "min-h-[460px]", "sm:min-h-[560px]"]) {
      expect(hero).toContain(cls);
      expect(skeleton).toContain(cls);
    }
  });

  it("taps: no grey highlight flash and no double-tap-zoom delay on links and buttons", () => {
    const css = read("app/globals.css");
    expect(css).toContain("-webkit-tap-highlight-color: transparent");
    expect(css).toContain("touch-action: manipulation");
  });

  it("the page declares a dark theme colour and colour scheme for the browser chrome", () => {
    // Read as text: importing the layout would pull in next/font, which
    // only exists inside the Next build.
    const layout = read("app/layout.tsx");
    expect(layout).toMatch(/export async function generateViewport\(\): Promise<Viewport>/);
    expect(layout).toContain("themeColor: themeCanvas(");
    expect(layout).toContain('colorScheme: "dark"');
  });
});
