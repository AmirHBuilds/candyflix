import { describe, it, expect, beforeEach } from "vitest";
import {
  DEFAULT_SUBTITLE_SETTINGS,
  loadSubtitleSettings,
  saveSubtitleSettings,
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
