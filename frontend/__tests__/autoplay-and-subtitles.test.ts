import { describe, it, expect, beforeEach } from "vitest";
import { consumeAutoplayFlag, flagAutoplayNext } from "@/lib/autoplay";
import { resolveInitialSubtitle } from "@/components/player/subtitle-preference";
import { DEFAULT_SETTINGS } from "@/lib/settings";

describe("autoplay hand-over flag", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("is false when nothing set it", () => expect(consumeAutoplayFlag()).toBe(false));

  it("is true once, then consumed (a refresh doesn't replay)", () => {
    flagAutoplayNext();
    expect(consumeAutoplayFlag()).toBe(true);
    expect(consumeAutoplayFlag()).toBe(false);
  });

  it("goes stale after 30 seconds, so it can't leak into a later visit", () => {
    flagAutoplayNext();
    expect(consumeAutoplayFlag(Date.now() + 31_000)).toBe(false);
  });

  it("is harmless when storage is unavailable", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("denied");
    };
    try {
      expect(() => flagAutoplayNext()).not.toThrow();
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});

describe("resolveInitialSubtitle", () => {
  const auto = DEFAULT_SETTINGS.playback.auto_subtitles;
  const base = { perVideo: undefined, rememberPerVideo: true, auto };

  it("captions off by default, with nothing remembered", () => {
    expect(resolveInitialSubtitle(base)).toEqual({ kind: "off" });
  });

  it("a language picked in another video never carries over", () => {
    expect(resolveInitialSubtitle({ ...base })).toEqual({ kind: "off" });
  });

  it("with auto subtitles, uses the preferred language then the backup, ", () => {
    const r = resolveInitialSubtitle({ ...base, auto: { enabled: true, language: "fa", fallback_language: "en" } });
    expect(r).toEqual({ kind: "languages", languages: ["fa", "en"] });
  });

  it("drops an unset or duplicate backup", () => {
    expect(resolveInitialSubtitle({ ...base, auto: { enabled: true, language: "en", fallback_language: null } })).toEqual({ kind: "languages", languages: ["en"] });
    expect(resolveInitialSubtitle({ ...base, auto: { enabled: true, language: "en", fallback_language: "en" } })).toEqual({ kind: "languages", languages: ["en"] });
  });

  it("this video's own choice wins over auto subtitles", () => {
    const a = { enabled: true, language: "fa", fallback_language: null };
    expect(resolveInitialSubtitle({ ...base, auto: a, perVideo: "es" })).toEqual({ kind: "languages", languages: ["es"] });
  });

  it("'off' saved for this video keeps captions off even with auto subtitles on", () => {
    const a = { enabled: true, language: "fa", fallback_language: null };
    expect(resolveInitialSubtitle({ ...base, auto: a, perVideo: "off" })).toEqual({ kind: "off" });
  });

  it("ignores the per-video choice when 'Remember settings per video' is off", () => {
    expect(resolveInitialSubtitle({ ...base, rememberPerVideo: false, perVideo: "es" })).toEqual({ kind: "off" });
  });
});
