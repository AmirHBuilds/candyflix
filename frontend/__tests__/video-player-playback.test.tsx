// Renders the real VideoPlayer (jsdom has no media pipeline, so the
// <video> element's duration/readyState/currentTime/play are faked) and
// checks what the Phase 9d playback settings actually do.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/playback", async () => {
  const actual = await vi.importActual<typeof import("@/lib/playback")>("@/lib/playback");
  return {
    ...actual,
    navigateWithResumeHint: vi.fn(),
    patchVideoSettings: vi.fn(),
    searchOnlineSubtitles: vi.fn().mockResolvedValue({ results: [], hasMore: false }),
    downloadOnlineSubtitle: vi.fn(),
    saveWatchProgress: vi.fn().mockResolvedValue(undefined),
    saveWatchProgressBeacon: vi.fn(),
    recordEpisodeVisit: vi.fn(),
    recordMovieVisit: vi.fn(),
    getSegments: vi.fn().mockResolvedValue({ intro: null, recap: null, credits: null }),
  };
});

vi.mock("@/lib/settings", async () => {
  const actual = await vi.importActual<typeof import("@/lib/settings")>("@/lib/settings");
  return { ...actual, patchSettings: vi.fn() };
});

import VideoPlayer from "@/components/player/VideoPlayer";
import { SettingsProvider } from "@/components/SettingsProvider";
import * as playback from "@/lib/playback";
import * as settingsLib from "@/lib/settings";
import { consumeAutoplayFlag, flagAutoplayNext } from "@/lib/autoplay";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings";
import type { PlaybackSource } from "@/lib/playback";

const play = vi.fn().mockResolvedValue(undefined);
let currentTimeValue = 0;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(playback.searchOnlineSubtitles).mockReset().mockResolvedValue({ results: [], hasMore: false });
  vi.mocked(playback.downloadOnlineSubtitle).mockReset();
  vi.mocked(playback.getSegments).mockReset().mockResolvedValue({ intro: null, recap: null, credits: null });
  window.sessionStorage.clear();
  window.localStorage.clear();
  currentTimeValue = 0;
  play.mockClear();
  // A video that already knows its metadata (so the player's resume logic runs at once).
  Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => 4 });
  Object.defineProperty(HTMLMediaElement.prototype, "duration", { configurable: true, get: () => 100 });
  Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
    configurable: true,
    get: () => currentTimeValue,
    set: (v: number) => {
      currentTimeValue = v;
    },
  });
  HTMLMediaElement.prototype.play = play as unknown as typeof HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.pause = vi.fn();
  HTMLMediaElement.prototype.load = vi.fn();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "" }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const source = (over: Partial<PlaybackSource> = {}): PlaybackSource => ({
  source_type: "mock",
  url: "/mock-videos/x.mp4",
  subtitles: [],
  resume_position_seconds: null,
  video_settings: {},
  ...over,
});

const identity = { tmdbId: 1396, mediaType: "tv" as const, seasonNumber: 1, episodeNumber: 2 };
const next = { href: "/watch/tv/1396/1/3", label: "Episode three" };

function settingsWith(playbackOver: Partial<Settings["playback"]> = {}): Settings {
  return { ...DEFAULT_SETTINGS, playback: { ...DEFAULT_SETTINGS.playback, ...playbackOver } };
}

function mount(opts: { playback?: Partial<Settings["playback"]>; source?: Partial<PlaybackSource>; next?: typeof next | null } = {}) {
  return render(
    <SettingsProvider initial={settingsWith(opts.playback)}>
      <VideoPlayer
        source={source(opts.source)}
        title="Show — Ep"
        identity={identity}
        backHref="/tv/1396"
        nextEpisode={opts.next === undefined ? next : opts.next}
      />
    </SettingsProvider>
  );
}

const videoOf = (c: HTMLElement) => c.querySelector("video") as HTMLVideoElement;
const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe("Start playing when a video opens", () => {
  it("plays by itself when the setting is on", () => {
    mount({ playback: { autoplay_on_open: true } });
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("waits for a click when it's off", () => {
    mount({ playback: { autoplay_on_open: false } });
    expect(play).not.toHaveBeenCalled();
  });

  it("still plays when it's off if the previous episode's autoplay handed over (once)", () => {
    flagAutoplayNext();
    mount({ playback: { autoplay_on_open: false } });
    expect(play).toHaveBeenCalledTimes(1);
    expect(consumeAutoplayFlag()).toBe(false); // consumed
  });

  it("a browser that refuses to autoplay just leaves it paused", async () => {
    play.mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
    expect(() => mount({ playback: { autoplay_on_open: true } })).not.toThrow();
    await act(async () => {});
  });
});

describe("Save watch progress", () => {
  it("on: jumps back to where you stopped", () => {
    const { container } = mount({ source: { resume_position_seconds: 42 } });
    expect(videoOf(container).currentTime).toBe(42);
  });

  it("off: starts from the beginning and saves nothing", () => {
    const { container } = mount({ playback: { save_progress: false }, source: { resume_position_seconds: 42 } });
    const video = videoOf(container);
    expect(video.currentTime).toBe(0);
    act(() => void video.dispatchEvent(new Event("pause")));
    expect(playback.saveWatchProgress).not.toHaveBeenCalled();
    // ...but the "opened" record is still made, so Continue Watching works.
    expect(playback.recordEpisodeVisit).toHaveBeenCalledWith(1396, 1, 2);
  });

  it("off: leaving for the next episode doesn't save a position either", () => {
    mount({ playback: { save_progress: false } });
    fireEvent.click(screen.getByLabelText("Next episode"));
    expect(playback.navigateWithResumeHint).toHaveBeenCalledWith(identity, next.href, false);
  });

  it("on: the next-episode button saves as before", () => {
    mount();
    fireEvent.click(screen.getByLabelText("Next episode"));
    expect(playback.navigateWithResumeHint).toHaveBeenCalledWith(identity, next.href, true);
  });
});

describe("Autoplay next episode", () => {
  const endVideo = (c: HTMLElement) => act(() => void videoOf(c).dispatchEvent(new Event("ended")));

  it("on: when the video ends, counts down 5 s and goes to the next episode, handing over autoplay", () => {
    vi.useFakeTimers();
    const { container } = mount();
    endVideo(container);
    expect(screen.getByText(/Up next · playing in 5s/)).toBeInTheDocument();
    expect(screen.getByText("Episode three")).toBeInTheDocument();
    tick(4000);
    expect(screen.getByText(/playing in 1s/)).toBeInTheDocument();
    expect(playback.navigateWithResumeHint).not.toHaveBeenCalled();
    tick(1000);
    expect(playback.navigateWithResumeHint).toHaveBeenCalledWith(identity, next.href, true);
    expect(consumeAutoplayFlag()).toBe(true);
  });

  it("Cancel stops it and hides the card", () => {
    vi.useFakeTimers();
    const { container } = mount();
    endVideo(container);
    tick(2000);
    fireEvent.click(screen.getByRole("button", { name: "Cancel autoplay" }));
    tick(10_000);
    expect(playback.navigateWithResumeHint).not.toHaveBeenCalled();
    expect(screen.queryByText(/Up next/)).toBeNull();
  });

  it("Play now goes straight away, also handing over autoplay", () => {
    vi.useFakeTimers();
    const { container } = mount();
    endVideo(container);
    fireEvent.click(screen.getByRole("link", { name: "Play now" }));
    expect(playback.navigateWithResumeHint).toHaveBeenCalledWith(identity, next.href, true);
    expect(consumeAutoplayFlag()).toBe(true);
  });

  it("replaying or seeking back before it fires cancels the countdown", () => {
    vi.useFakeTimers();
    const { container } = mount();
    endVideo(container);
    tick(3000);
    act(() => void videoOf(container).dispatchEvent(new Event("play")));
    tick(10_000);
    expect(playback.navigateWithResumeHint).not.toHaveBeenCalled();
  });

  it("off: the card at the end is the plain 'Up next' one, and nothing happens by itself", () => {
    vi.useFakeTimers();
    const { container } = mount({ playback: { autoplay_next: false } });
    endVideo(container);
    expect(screen.getByText("Up next")).toBeInTheDocument();
    expect(screen.queryByText(/playing in/)).toBeNull();
    tick(30_000);
    expect(playback.navigateWithResumeHint).not.toHaveBeenCalled();
  });

  it("the last episode (no next) just stops, offering Watch Again", () => {
    vi.useFakeTimers();
    const { container } = mount({ next: null });
    endVideo(container);
    tick(30_000);
    expect(playback.navigateWithResumeHint).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Watch Again" })).toBeInTheDocument();
  });
});

describe("Remember settings per video", () => {
  it("on: applies this video's saved volume", () => {
    const { container } = mount({ source: { video_settings: { volume: 0.3, muted: false } } });
    expect(videoOf(container).volume).toBe(0.3);
  });

  it("off: ignores the saved per-video volume (uses the general last-used one)", () => {
    const { container } = mount({ playback: { remember_per_video: false }, source: { video_settings: { volume: 0.3 } } });
    expect(videoOf(container).volume).toBe(1);
  });

  it("on: a volume change is saved for this video once the slider settles", () => {
    vi.useFakeTimers();
    mount();
    const slider = screen.getByLabelText("Volume");
    fireEvent.change(slider, { target: { value: "0.5" } });
    fireEvent.change(slider, { target: { value: "0.4" } });
    expect(playback.patchVideoSettings).not.toHaveBeenCalled();
    tick(700);
    expect(playback.patchVideoSettings).toHaveBeenCalledTimes(1);
    expect(playback.patchVideoSettings).toHaveBeenCalledWith(identity, { volume: 0.4, muted: false });
  });

  it("off: nothing is saved per video", () => {
    vi.useFakeTimers();
    mount({ playback: { remember_per_video: false } });
    fireEvent.change(screen.getByLabelText("Volume"), { target: { value: "0.5" } });
    tick(2000);
    expect(playback.patchVideoSettings).not.toHaveBeenCalled();
  });

  it("on: muting is saved for this video", () => {
    mount();
    fireEvent.click(screen.getByLabelText("Mute/unmute"));
    expect(playback.patchVideoSettings).toHaveBeenCalledWith(identity, { muted: true });
  });
});

describe("Subtitles on start", () => {
  const fa = { language: "fa", label: "Persian", url: "/subtitle-cache/fa.vtt", format: "vtt" as const };

  it("a language this video was left on is selected", () => {
    mount({ source: { subtitles: [fa], video_settings: { subtitle_language: "fa" } } });
    expect(screen.getByLabelText("Turn off subtitles")).toBeInTheDocument();
  });

  it("'off' saved for this video keeps captions off", () => {
    mount({
      playback: { auto_subtitles: { enabled: true, language: "fa", fallback_language: null } },
      source: { subtitles: [fa], video_settings: { subtitle_language: "off" } },
    });
    expect(screen.getByLabelText("Turn on subtitles")).toBeInTheDocument();
  });

  it("auto subtitles select the preferred language when this title has it", () => {
    mount({ playback: { auto_subtitles: { enabled: true, language: "fa", fallback_language: null } }, source: { subtitles: [fa] } });
    expect(screen.getByLabelText("Turn off subtitles")).toBeInTheDocument();
  });

  it("auto subtitles look the preferred language up online, then try the backup", async () => {
    vi.mocked(playback.searchOnlineSubtitles).mockImplementation(async (p) =>
      p.language === "es"
        ? { results: [{ file_id: 9, language: "es", label: "Spanish", release: null, downloads: 1, rating: null, hearing_impaired: false }], hasMore: false }
        : { results: [], hasMore: false }
    );
    vi.mocked(playback.downloadOnlineSubtitle).mockResolvedValue({ language: "es", label: "Spanish", url: "/subtitle-cache/es.vtt", format: "vtt" });
    mount({ playback: { auto_subtitles: { enabled: true, language: "fa", fallback_language: "es" } } });
    await act(async () => {});
    const asked = vi.mocked(playback.searchOnlineSubtitles).mock.calls.map(([p]) => p.language);
    expect(asked).toEqual(["fa", "es"]);
    expect(screen.getByLabelText("Turn off subtitles")).toBeInTheDocument();
  });

  it("captions stay off when auto subtitles find nothing in either language", async () => {
    mount({ playback: { auto_subtitles: { enabled: true, language: "fa", fallback_language: "es" } } });
    await act(async () => {});
    expect(screen.getByLabelText("Turn on subtitles")).toBeInTheDocument();
  });

  it("choosing a language in the player is remembered for this video", async () => {
    mount({ source: { subtitles: [fa] } });
    fireEvent.click(screen.getByLabelText("Turn on subtitles"));
    expect(playback.patchVideoSettings).toHaveBeenCalledWith(identity, { subtitle_language: "fa" });
    fireEvent.click(screen.getByLabelText("Turn off subtitles"));
    expect(playback.patchVideoSettings).toHaveBeenLastCalledWith(identity, { subtitle_language: "off" });
  });
});

describe("Subtitle look is site-wide; language and timing are per video", () => {
  const fa = { language: "fa", label: "Persian", url: "/subtitle-cache/fa.vtt", format: "vtt" as const };
  const vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:50.000\nHello there";

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => vtt }));
    vi.mocked(settingsLib.patchSettings).mockImplementation(async () => DEFAULT_SETTINGS);
  });

  function mountStyled(globalOver: Partial<Settings["subtitles"]>, video_settings: PlaybackSource["video_settings"] = {}) {
    return render(
      <SettingsProvider initial={{ ...DEFAULT_SETTINGS, subtitles: { ...DEFAULT_SETTINGS.subtitles, ...globalOver } }}>
        <VideoPlayer source={source({ subtitles: [fa], video_settings: { subtitle_language: "fa", ...video_settings } })} title="t" identity={identity} backHref="/" nextEpisode={null} />
      </SettingsProvider>
    );
  }

  it("a language picked in one video does not carry over to the next one", () => {
    const first = mount({ source: { subtitles: [fa] } });
    fireEvent.click(screen.getByLabelText("Turn on subtitles"));
    expect(screen.getByLabelText("Turn off subtitles")).toBeInTheDocument();
    first.unmount();
    mount({ source: { subtitles: [fa] } });
    expect(screen.getByLabelText("Turn on subtitles")).toBeInTheDocument();
  });

  it("uses the colour and size from Settings → Subtitles", async () => {
    mountStyled({ color: "#ff0000", font_size: 30 });
    const text = await screen.findByText("Hello there");
    expect(text).toHaveStyle({ color: "rgb(255, 0, 0)", fontSize: "30px" });
  });

  it("this video's saved timing is applied (and the look is untouched)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "WEBVTT\n\n00:00:10.000 --> 00:00:50.000\nLate line" }));
    mountStyled({}, { subtitle_offset: -10 }); // shows 10 s earlier, so a 10 s cue is visible at t = 0
    expect(await screen.findByText("Late line")).toBeInTheDocument();
  });

  it("timing from another video is not used", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "WEBVTT\n\n00:00:10.000 --> 00:00:50.000\nLate line" }));
    mountStyled({});
    await act(async () => {});
    expect(screen.queryByText("Late line")).toBeNull();
  });
});

describe("Skip intro / recap / credits", () => {
  const seg = (start: number, end: number) => ({ start, end, source: "skipdb" as const });
  const withSegments = (over: Partial<Awaited<ReturnType<typeof playback.getSegments>>> = {}) =>
    vi.mocked(playback.getSegments).mockResolvedValue({ intro: seg(10, 60), recap: seg(0, 8), credits: seg(90, 100), ...over });

  async function mountAt(time: number, opts: Parameters<typeof mount>[0] = {}) {
    currentTimeValue = time;
    const view = mount({ next: null, ...opts });
    await act(async () => {});
    const video = videoOf(view.container);
    act(() => void video.dispatchEvent(new Event("timeupdate")));
    return { ...view, video };
  }

  it("asks for the skip points once the length is known, with this video's identity and length", async () => {
    withSegments();
    await mountAt(0);
    expect(playback.getSegments).toHaveBeenCalledTimes(1);
    expect(playback.getSegments).toHaveBeenCalledWith(expect.objectContaining({ tmdbId: 1396, seasonNumber: 1, episodeNumber: 2 }), 100);
  });

  it("doesn't ask when auto-skip and every button are off", async () => {
    withSegments();
    await mountAt(0, { playback: { auto_skip_intro: false, skip_buttons: { intro: false, recap: false, credits: false } } });
    expect(playback.getSegments).not.toHaveBeenCalled();
  });

  it("shows Skip Intro during the intro, and clicking it jumps to the end of the intro", async () => {
    withSegments();
    const { video } = await mountAt(20);
    fireEvent.click(screen.getByLabelText("Skip Intro"));
    expect(video.currentTime).toBe(60);
  });

  it("shows the recap and credits buttons in their parts, and nothing between them", async () => {
    withSegments();
    const first = await mountAt(3);
    expect(screen.getByLabelText("Skip Recap")).toBeInTheDocument();
    first.unmount();
    const second = await mountAt(95);
    expect(screen.getByLabelText("Skip Credits")).toBeInTheDocument();
    second.unmount();
    await mountAt(70);
    expect(screen.queryByLabelText(/^Skip /)).toBeNull();
  });

  it("a button switched off in Settings isn't shown", async () => {
    withSegments();
    await mountAt(20, { playback: { skip_buttons: { intro: false, recap: true, credits: true } } });
    expect(screen.queryByLabelText("Skip Intro")).toBeNull();
  });

  it("no data (or a failed lookup) means no buttons and no error", async () => {
    vi.mocked(playback.getSegments).mockRejectedValue(new Error("down"));
    await mountAt(20);
    expect(screen.queryByLabelText(/^Skip /)).toBeNull();
  });

  it("the button hides with the controls and comes back with them", async () => {
    withSegments();
    vi.useFakeTimers();
    const { video, container } = await mountAt(20);
    const button = () => screen.getByLabelText("Skip Intro");
    expect(button().className).toContain("opacity-100");
    Object.defineProperty(video, "paused", { configurable: true, get: () => false });
    tick(10_000); // the controls auto-hide while playing
    expect(button().className).toContain("opacity-0");
    act(() => void fireEvent.mouseMove(container.firstElementChild as HTMLElement));
    expect(button().className).toContain("opacity-100");
  });

  describe("auto-skip", () => {
    it("jumps past the intro by itself when on, once", async () => {
      withSegments();
      const { video } = await mountAt(12, { playback: { auto_skip_intro: true } });
      expect(video.currentTime).toBe(60);
      // rewinding into the intro afterwards is left alone
      currentTimeValue = 20;
      act(() => void video.dispatchEvent(new Event("timeupdate")));
      expect(video.currentTime).toBe(20);
      expect(screen.getByLabelText("Skip Intro")).toBeInTheDocument(); // the button is still there to use
    });

    it("does nothing when off", async () => {
      withSegments();
      const { video } = await mountAt(12, { playback: { auto_skip_intro: false } });
      expect(video.currentTime).toBe(12);
    });

    it("never auto-skips credits or recap", async () => {
      withSegments();
      const { video } = await mountAt(95, { playback: { auto_skip_intro: true } });
      expect(video.currentTime).toBe(95);
    });

    it("works even if the Skip Intro button is switched off", async () => {
      withSegments();
      const { video } = await mountAt(12, { playback: { auto_skip_intro: true, skip_buttons: { intro: false, recap: true, credits: true } } });
      expect(video.currentTime).toBe(60);
    });
  });
});
