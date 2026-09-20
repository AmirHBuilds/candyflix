import { describe, it, expect, beforeEach } from "vitest";
import {
  DEFAULT_PLAYER_PREFERENCES,
  loadPlayerPreferences,
  savePlayerPreferences,
} from "@/components/player/player-preferences";

beforeEach(() => {
  window.localStorage.clear();
});

describe("player preferences persistence", () => {
  it("returns defaults when nothing is saved", () => {
    expect(loadPlayerPreferences()).toEqual(DEFAULT_PLAYER_PREFERENCES);
  });

  it("round-trips a saved preferences object", () => {
    const custom = { volume: 0.4, muted: true, subtitleLanguage: "fa" };
    savePlayerPreferences(custom);

    expect(loadPlayerPreferences()).toEqual(custom);
  });

  it("merges partial/older saved data with current defaults (forward compatibility)", () => {
    window.localStorage.setItem("candyflix:player-preferences", JSON.stringify({ volume: 0.2 }));

    const loaded = loadPlayerPreferences();
    expect(loaded.volume).toBe(0.2);
    expect(loaded.muted).toBe(DEFAULT_PLAYER_PREFERENCES.muted);
    expect(loaded.subtitleLanguage).toBe(DEFAULT_PLAYER_PREFERENCES.subtitleLanguage);
  });

  it("falls back to defaults on corrupted JSON instead of throwing", () => {
    window.localStorage.setItem("candyflix:player-preferences", "{not valid json");

    expect(() => loadPlayerPreferences()).not.toThrow();
    expect(loadPlayerPreferences()).toEqual(DEFAULT_PLAYER_PREFERENCES);
  });

  it("persists subtitles being turned off (null), not just a language", () => {
    savePlayerPreferences({ volume: 1, muted: false, subtitleLanguage: "en" });
    savePlayerPreferences({ volume: 1, muted: false, subtitleLanguage: null });

    expect(loadPlayerPreferences().subtitleLanguage).toBeNull();
  });
});
