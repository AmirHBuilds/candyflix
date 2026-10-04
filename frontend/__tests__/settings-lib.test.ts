import { describe, it, expect, vi, afterEach } from "vitest";

import {
  DEFAULT_SETTINGS,
  SettingsError,
  applyPatch,
  getSettings,
  patchSettings,
  resetSettings,
} from "@/lib/settings";

afterEach(() => vi.unstubAllGlobals());

describe("DEFAULT_SETTINGS (generated from the backend schema)", () => {
  it("keeps today's behaviour as the default, with the new default theme name", () => {
    expect(DEFAULT_SETTINGS.appearance.theme).toBe("candy-at-night");
    expect(DEFAULT_SETTINGS.appearance.home_layout).toBe("grid");
    expect(DEFAULT_SETTINGS.appearance.items_per_section).toBe(24);
    expect(DEFAULT_SETTINGS.appearance.description_length).toBe("standard");
    expect(DEFAULT_SETTINGS.playback.seek_seconds).toBe(10);
    expect(DEFAULT_SETTINGS.playback.autoplay_on_open).toBe(true);
    expect(DEFAULT_SETTINGS.subtitles.font_size).toBe(22);
  });

  it("has no timing offset: that only ever exists per video", () => {
    expect(Object.keys(DEFAULT_SETTINGS.subtitles)).not.toContain("offset_seconds");
  });
});

describe("applyPatch", () => {
  it("changes only what the patch names, leaving siblings alone", () => {
    const next = applyPatch(DEFAULT_SETTINGS, { appearance: { theme: "mint" } }, DEFAULT_SETTINGS);
    expect(next.appearance.theme).toBe("mint");
    expect(next.appearance.text_size).toBe("default");
    expect(next.playback).toEqual(DEFAULT_SETTINGS.playback);
  });

  it("merges nested groups (skip_buttons) rather than replacing them", () => {
    const next = applyPatch(DEFAULT_SETTINGS, { playback: { skip_buttons: { recap: false } } }, DEFAULT_SETTINGS);
    expect(next.playback.skip_buttons).toEqual({ intro: true, recap: false, credits: true });
  });

  it("null puts a setting back to its default (same rule as the server)", () => {
    const changed = applyPatch(DEFAULT_SETTINGS, { appearance: { theme: "mint", text_size: "large" } }, DEFAULT_SETTINGS);
    const reset = applyPatch(changed, { appearance: { theme: null } }, DEFAULT_SETTINGS);
    expect(reset.appearance.theme).toBe("candy-at-night");
    expect(reset.appearance.text_size).toBe("large");
  });

  it("never mutates its inputs", () => {
    const before = JSON.stringify(DEFAULT_SETTINGS);
    applyPatch(DEFAULT_SETTINGS, { playback: { seek_seconds: 30 } }, DEFAULT_SETTINGS);
    expect(JSON.stringify(DEFAULT_SETTINGS)).toBe(before);
  });
});

describe("settings API calls", () => {
  const okResponse = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it("getSettings reads with the session cookie and no caching", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(DEFAULT_SETTINGS));
    vi.stubGlobal("fetch", fetchMock);

    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/settings$/),
      expect.objectContaining({ credentials: "include", cache: "no-store" })
    );
  });

  it("patchSettings sends only the patch, as JSON, via PATCH", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(DEFAULT_SETTINGS));
    vi.stubGlobal("fetch", fetchMock);

    await patchSettings({ playback: { seek_seconds: 20 } });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("PATCH");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(init.body)).toEqual({ playback: { seek_seconds: 20 } });
  });

  it("a 422 becomes a SettingsError carrying the server's readable problems", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: ["Unknown setting 'x'"] }), { status: 422 }))
    );
    const err = await patchSettings({}).catch((e) => e);
    expect(err).toBeInstanceOf(SettingsError);
    expect(err.problems).toEqual(["Unknown setting 'x'"]);
  });

  it("other failures throw a plain error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 500 })));
    await expect(patchSettings({})).rejects.toThrow("Failed to save settings");
    await expect(getSettings()).rejects.toThrow("Failed to load settings");
    await expect(resetSettings()).rejects.toThrow("Failed to reset settings");
  });

  it("resetSettings uses DELETE", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(DEFAULT_SETTINGS));
    vi.stubGlobal("fetch", fetchMock);
    await resetSettings();
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
  });
});
