import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("hls.js", () => ({
  default: class {
    static isSupported() {
      return true;
    }
    static Events = { ERROR: "e", FRAG_LOADED: "f" };
    static ErrorTypes = { NETWORK_ERROR: "n", MEDIA_ERROR: "m" };
    loadSource = vi.fn();
    attachMedia = vi.fn();
    destroy = vi.fn();
    on = vi.fn();
    startLoad = vi.fn();
    stopLoad = vi.fn();
    recoverMediaError = vi.fn();
  },
}));
vi.mock("@/lib/playback", async () => {
  const actual = await vi.importActual<typeof import("@/lib/playback")>("@/lib/playback");
  return {
    ...actual,
    navigateWithResumeHint: vi.fn(),
    patchVideoSettings: vi.fn(),
    searchOnlineSubtitles: vi.fn().mockResolvedValue({ results: [], hasMore: false }),
    saveWatchProgress: vi.fn().mockResolvedValue(undefined),
    saveWatchProgressBeacon: vi.fn(),
    recordEpisodeVisit: vi.fn(),
    recordMovieVisit: vi.fn(),
    getSegments: vi.fn().mockResolvedValue({ intro: null, recap: null, credits: null }),
  };
});
vi.mock("@/lib/settings", async () => {
  const actual = await vi.importActual<typeof import("@/lib/settings")>("@/lib/settings");
  return { ...actual, patchSettings: vi.fn(), resetSettings: vi.fn(), getSettings: vi.fn() };
});

import VideoPlayer from "@/components/player/VideoPlayer";
import { SettingsProvider } from "@/components/SettingsProvider";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import type { PlaybackSource } from "@/lib/playback";

let mediaDuration = 100;
let currentTime = 0;

beforeEach(() => {
  vi.clearAllMocks();
  mediaDuration = 100;
  currentTime = 0;
  Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => 4 });
  Object.defineProperty(HTMLMediaElement.prototype, "duration", { configurable: true, get: () => mediaDuration });
  Object.defineProperty(HTMLMediaElement.prototype, "currentTime", { configurable: true, get: () => currentTime, set: (v: number) => void (currentTime = v) });
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined) as never;
  HTMLMediaElement.prototype.pause = vi.fn();
  HTMLMediaElement.prototype.load = vi.fn();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "" }));
});
afterEach(() => vi.unstubAllGlobals());

const src = (resume: number | null): PlaybackSource => ({ source_type: "resolver", url: "/api/resolve/relay?u=x", subtitles: [], resume_position_seconds: resume, video_settings: {} });
const identity = { tmdbId: 550, mediaType: "movie" as const };

function mount(growth: { ready: boolean; progress: number | null; durationSeconds?: number | null; runtimeSeconds: number | null }, resume: number | null = null) {
  return render(
    <SettingsProvider initial={{ ...DEFAULT_SETTINGS, playback: { ...DEFAULT_SETTINGS.playback, autoplay_on_open: false } }}>
      <VideoPlayer source={src(resume)} title="t" identity={identity} backHref="/" growth={growth} />
    </SettingsProvider>
  );
}

describe("a video that is still downloading", () => {
  it("shows the listed length and a bar for what has downloaded", () => {
    mount({ ready: false, progress: 3, runtimeSeconds: 6000 });
    expect(screen.getByText("0:00 / 1:40:00")).toBeInTheDocument();
    const bar = screen.getByTestId("downloaded-bar");
    expect(parseFloat(bar.style.width)).toBeCloseTo((100 / 6000) * 100, 1);
  });

  it("uses the real length from the resolver and never changes it as more downloads", () => {
    mediaDuration = 600;
    const { rerender } = mount({ ready: false, progress: 10, durationSeconds: 5400, runtimeSeconds: 6000 });
    expect(screen.getByText("0:00 / 1:30:00")).toBeInTheDocument();
    mediaDuration = 3000;
    rerender(
      <SettingsProvider initial={{ ...DEFAULT_SETTINGS, playback: { ...DEFAULT_SETTINGS.playback, autoplay_on_open: false } }}>
        <VideoPlayer source={src(null)} title="t" identity={identity} backHref="/" growth={{ ready: false, progress: 55, durationSeconds: 5400, runtimeSeconds: 6000 }} />
      </SettingsProvider>
    );
    act(() => void document.querySelector("video")!.dispatchEvent(new Event("durationchange")));
    expect(screen.getByText("0:00 / 1:30:00")).toBeInTheDocument();
  });

  it("falls back to the listed runtime, not to a guess from the download", () => {
    mediaDuration = 3000;
    mount({ ready: false, progress: 40, runtimeSeconds: 6000 });
    expect(screen.getByText("0:00 / 1:40:00")).toBeInTheDocument();
  });

  it("is plain once it is ready: the real length and no extra bar", () => {
    mount({ ready: true, progress: 100, runtimeSeconds: 6000 });
    expect(screen.getByText("0:00 / 1:40")).toBeInTheDocument();
    expect(screen.queryByTestId("downloaded-bar")).toBeNull();
  });

  it("waits for the download to reach the saved spot, then goes there", async () => {
    mount({ ready: false, progress: 20, runtimeSeconds: 6000 }, 3000);
    expect(await screen.findByTestId("waiting-for-download")).toBeInTheDocument();
    expect(screen.getByText(/up to 50:00/)).toBeInTheDocument();
    expect(currentTime).toBe(0);
    // more has downloaded, past the spot
    mediaDuration = 3100;
    const video = document.querySelector("video")!;
    act(() => void video.dispatchEvent(new Event("durationchange")));
    await waitFor(() => expect(screen.queryByTestId("waiting-for-download")).toBeNull());
    expect(currentTime).toBe(3000);
  });

  it("lets you start from the beginning instead of waiting", async () => {
    mount({ ready: false, progress: 20, runtimeSeconds: 6000 }, 3000);
    fireEvent.click(await screen.findByText("Start from the beginning"));
    await waitFor(() => expect(screen.queryByTestId("waiting-for-download")).toBeNull());
    expect(currentTime).toBe(0);
  });

  it("goes straight to the spot when it has already downloaded that far", async () => {
    mediaDuration = 4000;
    mount({ ready: false, progress: 60, runtimeSeconds: 6000 }, 3000);
    await waitFor(() => expect(currentTime).toBe(3000));
    expect(screen.queryByTestId("waiting-for-download")).toBeNull();
  });
});

describe("clicking the seek bar", () => {
  it("moves the bar and the time at once, before the video has loaded that part", () => {
    HTMLElement.prototype.getBoundingClientRect = () => ({ left: 0, width: 1000, top: 0, bottom: 4, right: 1000, height: 4, x: 0, y: 0, toJSON() {} }) as DOMRect;
    mediaDuration = 200;
    mount({ ready: true, progress: 100, durationSeconds: null, runtimeSeconds: null });
    fireEvent.mouseDown(screen.getByRole("slider", { name: "Seek" }), { clientX: 500 });
    expect(screen.getByText("1:40 / 3:20")).toBeInTheDocument(); // halfway, immediately
    expect(screen.getByRole("slider", { name: "Seek" })).toHaveAttribute("aria-valuenow", "100");
    currentTime = 100;
    act(() => void document.querySelector("video")!.dispatchEvent(new Event("seeked")));
    expect(screen.getByText("1:40 / 3:20")).toBeInTheDocument();
  });
});
