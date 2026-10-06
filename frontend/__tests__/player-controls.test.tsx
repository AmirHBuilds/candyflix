import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

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
import PlayerControlsDialog from "@/components/settings/PlayerControlsDialog";
import { CONTROLS, SWITCHABLE } from "@/components/player/controls";
import { SettingsProvider } from "@/components/SettingsProvider";
import * as playback from "@/lib/playback";
import * as lib from "@/lib/settings";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings";
import type { PlaybackSource } from "@/lib/playback";

const { navigateWithResumeHint } = playback;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(lib.patchSettings).mockImplementation(async () => DEFAULT_SETTINGS);
  vi.mocked(playback.getSegments).mockResolvedValue({ intro: null, recap: null, credits: null });
  Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => 4 });
  Object.defineProperty(HTMLMediaElement.prototype, "duration", { configurable: true, get: () => 100 });
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined) as never;
  HTMLMediaElement.prototype.pause = vi.fn();
  HTMLMediaElement.prototype.load = vi.fn();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "" }));
});
afterEach(() => vi.unstubAllGlobals());

const source: PlaybackSource = { source_type: "mock", url: "/x.mp4", subtitles: [], resume_position_seconds: null, video_settings: {} };
const identity = { tmdbId: 1396, mediaType: "tv" as const, seasonNumber: 1, episodeNumber: 2 };
const episode = (n: number) => ({ href: `/watch/tv/1396/1/${n}`, label: `Episode ${n}` });

function mount(controls: Partial<Settings["playback"]["controls"]> = {}) {
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    playback: { ...DEFAULT_SETTINGS.playback, autoplay_on_open: false, controls: { ...DEFAULT_SETTINGS.playback.controls, ...controls } },
  };
  return render(
    <SettingsProvider initial={settings}>
      <VideoPlayer source={source} title="t" identity={identity} backHref="/" nextEpisode={episode(3)} prevEpisode={episode(1)} />
    </SettingsProvider>
  );
}
const press = (key: string, init: KeyboardEventInit = {}) => act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key, ...init })));

describe("the registry", () => {
  it("lists exactly the switchable settings keys, plus the two locked controls", () => {
    expect(SWITCHABLE.map((c) => c.id).sort()).toEqual(Object.keys(DEFAULT_SETTINGS.playback.controls).sort());
    expect(CONTROLS.filter((c) => c.locked).map((c) => c.id)).toEqual(["play", "settings"]);
  });
});

describe("the control bar follows the settings", () => {
  it("shows the standard buttons by default, and none of the extras", () => {
    mount();
    for (const name of ["Play/Pause", "Previous episode", "Next episode", "Mute/unmute", "Volume", "Turn on subtitles", "Settings", "Fullscreen"]) {
      expect(screen.getByLabelText(name)).toBeInTheDocument();
    }
    expect(screen.getByText("0:00 / 1:40")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Back \d+ seconds/)).toBeNull();
    expect(screen.queryByLabelText(/^Forward \d+ seconds/)).toBeNull();
    expect(screen.queryByLabelText("Picture in picture")).toBeNull();
  });

  it.each([
    ["episodes", ["Previous episode", "Next episode"]],
    ["volume", ["Mute/unmute", "Volume"]],
    ["captions", ["Turn on subtitles"]],
    ["fullscreen", ["Fullscreen"]],
  ])("a switched-off %s control is gone", (id, labels) => {
    mount({ [id]: false });
    for (const label of labels) expect(screen.queryByLabelText(label)).toBeNull();
    expect(screen.getByLabelText("Play/Pause")).toBeInTheDocument();
    expect(screen.getByLabelText("Settings")).toBeInTheDocument();
  });

  it("hides the time when asked", () => {
    mount({ time: false });
    expect(screen.queryByText("0:00 / 1:40")).toBeNull();
  });

  it("shows the jump buttons when chosen, using the seek time, and they seek", () => {
    const { container } = mount({ seek_back: true, seek_forward: true });
    const video = container.querySelector("video") as HTMLVideoElement;
    let t = 50;
    Object.defineProperty(video, "currentTime", { configurable: true, get: () => t, set: (v: number) => (t = v) });
    fireEvent.click(screen.getByLabelText("Forward 10 seconds"));
    expect(t).toBe(60);
    fireEvent.click(screen.getByLabelText("Back 10 seconds"));
    expect(t).toBe(50);
  });

  it("only offers picture-in-picture where the browser supports it", () => {
    Object.defineProperty(document, "pictureInPictureEnabled", { configurable: true, value: false });
    const first = mount({ pip: true });
    expect(screen.queryByLabelText("Picture in picture")).toBeNull();
    first.unmount();
    Object.defineProperty(document, "pictureInPictureEnabled", { configurable: true, value: true });
    mount({ pip: true });
    expect(screen.getByLabelText("Picture in picture")).toBeInTheDocument();
    Object.defineProperty(document, "pictureInPictureEnabled", { configurable: true, value: undefined });
  });
});

describe("a removed control's shortcut stops working", () => {
  it("episode shortcuts work while the buttons are shown, and stop when they're removed", () => {
    const shown = mount();
    press("N", { shiftKey: true });
    expect(navigateWithResumeHint).toHaveBeenCalledTimes(1);
    press("P", { shiftKey: true });
    expect(navigateWithResumeHint).toHaveBeenCalledTimes(2);
    shown.unmount();
    mount({ episodes: false });
    press("N", { shiftKey: true });
    press("P", { shiftKey: true });
    expect(navigateWithResumeHint).toHaveBeenCalledTimes(2);
  });

  it("M and the volume arrows stop with the volume control; F stops with fullscreen; C with subtitles", () => {
    const { container } = mount({ volume: false, fullscreen: false, captions: false });
    const video = container.querySelector("video") as HTMLVideoElement;
    video.volume = 0.5;
    const fs = vi.fn().mockResolvedValue(undefined);
    (container.firstElementChild as HTMLElement).requestFullscreen = fs;
    press("m");
    press("ArrowUp");
    press("ArrowDown");
    press("f");
    press("c");
    expect(video.muted).toBe(false);
    expect(video.volume).toBe(0.5);
    expect(fs).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Turn off subtitles")).toBeNull();
  });

  it("the shortcuts still work when the controls are shown", () => {
    const { container } = mount();
    const video = container.querySelector("video") as HTMLVideoElement;
    video.volume = 0.5;
    press("m");
    expect(video.muted).toBe(true);
  });

  it("seeking with the arrow keys and J / L always works", () => {
    const { container } = mount({ volume: false, episodes: false });
    const video = container.querySelector("video") as HTMLVideoElement;
    let t = 50;
    Object.defineProperty(video, "currentTime", { configurable: true, get: () => t, set: (v: number) => (t = v) });
    press("ArrowRight");
    expect(t).toBe(60);
    press("j");
    expect(t).toBe(50);
  });
});

describe("the customiser dialog", () => {
  const renderDialog = (onClose = vi.fn()) =>
    render(
      <SettingsProvider initial={DEFAULT_SETTINGS}>
        <PlayerControlsDialog onClose={onClose} />
      </SettingsProvider>
    );

  it("shows the placeholder frame, a mock bar and a row for every control", () => {
    renderDialog();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("player-mockup").querySelector("img")).toHaveAttribute("src", "/images/player-preview.png");
    for (const c of CONTROLS) expect(screen.getAllByText(c.label).length).toBeGreaterThan(0);
  });

  it("Play/Pause and Settings can't be removed", () => {
    renderDialog();
    expect(screen.getByLabelText(/Play \/ Pause \(always shown\)/)).toBeDisabled();
    expect(screen.getByLabelText(/Settings \(always shown\)/)).toBeDisabled();
    expect(screen.getAllByText("Always on")).toHaveLength(2);
    expect(screen.queryByRole("switch", { name: "Play / Pause" })).toBeNull();
  });

  it("tapping a button in the mock bar removes it, and a switch brings it back", async () => {
    // The server's answer reflects the change, as the real one does.
    vi.mocked(lib.patchSettings).mockResolvedValueOnce({
      ...DEFAULT_SETTINGS,
      playback: { ...DEFAULT_SETTINGS.playback, controls: { ...DEFAULT_SETTINGS.playback.controls, fullscreen: false } },
    });
    renderDialog();
    fireEvent.click(screen.getByLabelText("Remove Fullscreen button"));
    await waitFor(() => expect(lib.patchSettings).toHaveBeenCalledWith({ playback: { controls: { fullscreen: false } } }));
    expect(await screen.findByLabelText("Add Fullscreen button")).toBeInTheDocument(); // shown as a dotted ghost
    fireEvent.click(screen.getByRole("switch", { name: "Fullscreen" }));
    await waitFor(() => expect(lib.patchSettings).toHaveBeenLastCalledWith({ playback: { controls: { fullscreen: true } } }));
  });

  it("extras are switched on from the list", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("switch", { name: "Picture in picture" }));
    await waitFor(() => expect(lib.patchSettings).toHaveBeenCalledWith({ playback: { controls: { pip: true } } }));
  });

  it("'Back to the standard buttons' resets every switchable control", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Back to the standard buttons" }));
    await waitFor(() => expect(lib.patchSettings).toHaveBeenCalled());
    const sent = vi.mocked(lib.patchSettings).mock.calls[0][0] as { playback: { controls: Record<string, null> } };
    expect(Object.keys(sent.playback.controls).sort()).toEqual(SWITCHABLE.map((c) => c.id).sort());
    expect(Object.values(sent.playback.controls).every((v) => v === null)).toBe(true);
  });

  it("Done closes it", () => {
    const onClose = vi.fn();
    renderDialog(onClose);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalled();
  });
});
