import { describe, it, expect } from "vitest";
import {
  DEFAULT_SUBTITLE_SETTINGS,
  formatOffset,
  formatOffsetForEditing,
  parseOffsetInput,
  stepOffsetSeconds,
} from "@/components/player/subtitle-settings";

import { DEFAULT_SETTINGS } from "@/lib/settings";
import { fromGlobalStyle, stylePatch } from "@/components/player/subtitle-settings";

const G = DEFAULT_SETTINGS.subtitles;

describe("global defaults and per-video overrides", () => {
  it("the defaults file matches the player's built-in defaults, with offset 0", () => {
    expect(fromGlobalStyle(G)).toEqual(DEFAULT_SUBTITLE_SETTINGS);
  });

  it("uses the person's global style", () => {
    const s = fromGlobalStyle({ ...G, color: "#ff0000", font_size: 30, background_opacity: 0.2 });
    expect(s).toMatchObject({ color: "#ff0000", fontSize: 30, backgroundOpacity: 0.2, offsetSeconds: 0 });
  });

  it("sends only the changed look keys, as global setting names; timing is not one of them", () => {
    const next = { ...DEFAULT_SUBTITLE_SETTINGS, fontSize: 30, offsetSeconds: 1.5, shadow: false };
    expect(stylePatch(DEFAULT_SUBTITLE_SETTINGS, next)).toEqual({ font_size: 30, shadow: false });
    expect(stylePatch(next, next)).toEqual({});
  });

  it("never reads or writes a shared browser-wide copy", () => {
    window.localStorage.setItem("candyflix:subtitle-settings", JSON.stringify({ fontSize: 50 }));
    expect(fromGlobalStyle(G).fontSize).toBe(22);
  });
});

describe("subtitle offset — no limits", () => {
  it("steps past the old ±10s bounds without clamping", () => {
    expect(stepOffsetSeconds(10, 100)).toBe(10.1);
    expect(stepOffsetSeconds(-10, -100)).toBe(-10.1);
  });
});

describe("stepOffsetSeconds", () => {
  it("moves by exactly 100 ms and never drifts, however many clicks", () => {
    let v = 0;
    for (let i = 0; i < 30; i++) v = stepOffsetSeconds(v, 100);
    expect(v).toBe(3); // naive 0.1 + 0.1 ... would give 3.0000000000000004
    for (let i = 0; i < 30; i++) v = stepOffsetSeconds(v, -100);
    expect(v).toBe(0);
  });

  it("re-anchors to whole milliseconds from a legacy float value", () => {
    expect(stepOffsetSeconds(0.30000000000000004, 100)).toBe(0.4);
  });
});

describe("formatOffset", () => {
  it("formats as signed seconds with one decimal and the unit", () => {
    expect(formatOffset(-2.3)).toBe("-2.3 S");
    expect(formatOffset(1.2)).toBe("+1.2 S");
    expect(formatOffset(0)).toBe("0.0 S");
    expect(formatOffset(12)).toBe("+12.0 S");
  });

  it("never shows a negative zero", () => {
    expect(formatOffset(-0.04)).toBe("0.0 S");
    expect(formatOffset(-0)).toBe("0.0 S");
  });

  it("rounds sub-tenth values for display only", () => {
    expect(formatOffset(1.25)).toBe("+1.3 S");
    expect(formatOffset(-1.25)).toBe("-1.3 S");
    expect(formatOffsetForEditing(1.25)).toBe("1.25"); // the edit box keeps full precision
  });
});

describe("parseOffsetInput (seconds)", () => {
  it.each([
    ["-2.3", -2.3],
    ["+1.5", 1.5],
    ["3", 3],
    [" 0.75 ", 0.75],
    ["1,5", 1.5],
    [".5", 0.5],
    ["-2.3 S", -2.3],
    ["4s", 4],
    ["\u22122.3", -2.3],
    ["250", 250], // no upper limit
    ["-0", 0],
  ])("accepts %j", (text, expected) => {
    expect(parseOffsetInput(text)).toBe(expected);
  });

  it("rounds extra decimals to the nearest millisecond", () => {
    expect(parseOffsetInput("1.23456")).toBe(1.235);
  });

  it.each(["", "abc", "1.2.3", "--1", "1e3", "12 ms", "NaN", "Infinity"])("rejects %j", (text) => {
    expect(parseOffsetInput(text)).toBeNull();
  });
});
