import { describe, it, expect, beforeEach } from "vitest";
import {
  DEFAULT_SUBTITLE_SETTINGS,
  formatOffset,
  formatOffsetForEditing,
  loadSubtitleSettings,
  parseOffsetInput,
  saveSubtitleSettings,
  stepOffsetSeconds,
} from "@/components/player/subtitle-settings";

beforeEach(() => {
  window.localStorage.clear();
});

describe("subtitle settings persistence", () => {
  it("returns defaults when nothing is saved", () => {
    expect(loadSubtitleSettings()).toEqual(DEFAULT_SUBTITLE_SETTINGS);
  });

  it("round-trips a saved settings object", () => {
    const custom = { ...DEFAULT_SUBTITLE_SETTINGS, fontSize: 30, color: "#ff0000" };
    saveSubtitleSettings(custom);

    expect(loadSubtitleSettings()).toEqual(custom);
  });

  it("merges partial/older saved data with current defaults (forward compatibility)", () => {
    window.localStorage.setItem("candyflix:subtitle-settings", JSON.stringify({ fontSize: 18 }));

    const loaded = loadSubtitleSettings();
    expect(loaded.fontSize).toBe(18);
    expect(loaded.color).toBe(DEFAULT_SUBTITLE_SETTINGS.color);
  });

  it("falls back to defaults on corrupted JSON instead of throwing", () => {
    window.localStorage.setItem("candyflix:subtitle-settings", "{not valid json");

    expect(() => loadSubtitleSettings()).not.toThrow();
    expect(loadSubtitleSettings()).toEqual(DEFAULT_SUBTITLE_SETTINGS);
  });
});

describe("subtitle offset — no limits", () => {
  it("persists and reloads an offset far outside the old ±10s slider range", () => {
    saveSubtitleSettings({ ...DEFAULT_SUBTITLE_SETTINGS, offsetSeconds: 137.4 });
    expect(loadSubtitleSettings().offsetSeconds).toBe(137.4);
    saveSubtitleSettings({ ...DEFAULT_SUBTITLE_SETTINGS, offsetSeconds: -3600 });
    expect(loadSubtitleSettings().offsetSeconds).toBe(-3600);
  });

  it("steps past the old ±10s bounds without clamping", () => {
    expect(stepOffsetSeconds(10, 100)).toBe(10.1);
    expect(stepOffsetSeconds(-10, -100)).toBe(-10.1);
  });

  it("refuses a non-numeric stored offset (falls back to 0) but keeps the rest", () => {
    window.localStorage.setItem(
      "candyflix:subtitle-settings",
      JSON.stringify({ fontSize: 18, offsetSeconds: "abc" })
    );
    const loaded = loadSubtitleSettings();
    expect(loaded.offsetSeconds).toBe(0);
    expect(loaded.fontSize).toBe(18);
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
