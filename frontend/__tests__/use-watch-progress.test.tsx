import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { useRef, useEffect } from "react";

import { useWatchProgress } from "@/components/player/useWatchProgress";
import * as playback from "@/lib/playback";

vi.mock("@/lib/playback", async () => {
  const actual = await vi.importActual<typeof playback>("@/lib/playback");
  return {
    ...actual,
    saveWatchProgress: vi.fn().mockResolvedValue(undefined),
    saveWatchProgressBeacon: vi.fn(),
    recordEpisodeVisit: vi.fn(),
    recordMovieVisit: vi.fn(),
  };
});

/** A tiny harness: mounts a real <video> element, attaches the hook to
 * it via a ref (matching how VideoPlayer actually uses the hook), and
 * exposes the element so tests can set currentTime/duration and fire
 * events on it directly. */
function Harness({
  tmdbId = 550,
  mediaType = "movie" as const,
  seasonNumber,
  episodeNumber,
  restored = true,
  saveProgress = true,
}: {
  tmdbId?: number;
  mediaType?: "movie" | "tv";
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  restored?: boolean;
  saveProgress?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useWatchProgress(videoRef, { tmdbId, mediaType, seasonNumber, episodeNumber }, restored, saveProgress);
  return <video ref={videoRef} data-testid="video" />;
}

function setMediaProps(video: HTMLVideoElement, { currentTime = 0, duration = 100, paused = false }) {
  Object.defineProperty(video, "currentTime", { value: currentTime, configurable: true });
  Object.defineProperty(video, "duration", { value: duration, configurable: true });
  Object.defineProperty(video, "paused", { value: paused, configurable: true });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useWatchProgress — periodic autosave", () => {
  it("saves every 10s while playing (not paused)", async () => {
    const { getByTestId } = render(<Harness />);
    const video = getByTestId("video") as HTMLVideoElement;
    setMediaProps(video, { currentTime: 5, duration: 100, paused: false });

    await vi.advanceTimersByTimeAsync(10_000);

    expect(playback.saveWatchProgress).toHaveBeenCalledWith(
      expect.objectContaining({ tmdb_id: 550, media_type: "movie", position_seconds: 5, duration_seconds: 100 })
    );
  });

  it("does NOT autosave while paused", async () => {
    const { getByTestId } = render(<Harness />);
    const video = getByTestId("video") as HTMLVideoElement;
    setMediaProps(video, { currentTime: 5, duration: 100, paused: true });

    await vi.advanceTimersByTimeAsync(10_000);

    expect(playback.saveWatchProgress).not.toHaveBeenCalled();
  });

  it("does not save when duration is unknown (metadata not loaded yet)", async () => {
    const { getByTestId } = render(<Harness />);
    const video = getByTestId("video") as HTMLVideoElement;
    setMediaProps(video, { currentTime: 5, duration: NaN, paused: false });

    await vi.advanceTimersByTimeAsync(10_000);

    expect(playback.saveWatchProgress).not.toHaveBeenCalled();
  });
});

describe("useWatchProgress — event-triggered saves", () => {
  it("saves immediately on pause", () => {
    const { getByTestId } = render(<Harness />);
    const video = getByTestId("video") as HTMLVideoElement;
    setMediaProps(video, { currentTime: 42, duration: 100 });

    video.dispatchEvent(new Event("pause"));

    expect(playback.saveWatchProgress).toHaveBeenCalledWith(
      expect.objectContaining({ position_seconds: 42 })
    );
  });

  it("saves immediately on seeked", () => {
    const { getByTestId } = render(<Harness />);
    const video = getByTestId("video") as HTMLVideoElement;
    setMediaProps(video, { currentTime: 77, duration: 100 });

    video.dispatchEvent(new Event("seeked"));

    expect(playback.saveWatchProgress).toHaveBeenCalledWith(
      expect.objectContaining({ position_seconds: 77 })
    );
  });

  it("saves immediately when playback starts, without waiting for the 10s interval", () => {
    const { getByTestId } = render(<Harness />);
    const video = getByTestId("video") as HTMLVideoElement;
    setMediaProps(video, { currentTime: 3, duration: 100 });

    video.dispatchEvent(new Event("play"));

    expect(playback.saveWatchProgress).toHaveBeenCalledWith(
      expect.objectContaining({ position_seconds: 3 })
    );
  });
});

describe("useWatchProgress — teardown-safe saves via sendBeacon", () => {
  it("uses sendBeacon (not fetch) when the tab is backgrounded", () => {
    const { getByTestId } = render(<Harness />);
    const video = getByTestId("video") as HTMLVideoElement;
    setMediaProps(video, { currentTime: 10, duration: 100 });

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(playback.saveWatchProgressBeacon).toHaveBeenCalledWith(
      expect.objectContaining({ position_seconds: 10 })
    );
    expect(playback.saveWatchProgress).not.toHaveBeenCalled();
  });

  it("uses sendBeacon on pagehide", () => {
    const { getByTestId } = render(<Harness />);
    const video = getByTestId("video") as HTMLVideoElement;
    setMediaProps(video, { currentTime: 99, duration: 100 });

    window.dispatchEvent(new Event("pagehide"));

    expect(playback.saveWatchProgressBeacon).toHaveBeenCalledWith(
      expect.objectContaining({ position_seconds: 99 })
    );
  });
});

describe("useWatchProgress — unmount save (client-side navigation away from the player)", () => {
  it("sends a final beacon with the current position when the player unmounts", () => {
    const { getByTestId, unmount } = render(<Harness />);
    setMediaProps(getByTestId("video") as HTMLVideoElement, { currentTime: 42, duration: 100 });
    vi.clearAllMocks();

    unmount();

    expect(playback.saveWatchProgressBeacon).toHaveBeenCalledWith(
      expect.objectContaining({ tmdb_id: 550, position_seconds: 42, duration_seconds: 100 })
    );
  });

  it("does not save on unmount while restored=false (would overwrite a real position with 0)", () => {
    const { getByTestId, unmount } = render(<Harness restored={false} />);
    setMediaProps(getByTestId("video") as HTMLVideoElement, { currentTime: 0, duration: 100 });

    unmount();

    expect(playback.saveWatchProgressBeacon).not.toHaveBeenCalled();
  });
});

describe("useWatchProgress — restoration gate (resume-overwritten-with-0 regression)", () => {
  // Real bug: VideoPlayer applies the saved resume position asynchronously
  // (it has to wait for video metadata). Before this gate existed, a
  // pause/seeked event firing during that window — while currentTime was
  // still 0, before the resume seek had taken effect — got saved as-is,
  // silently overwriting a real saved position with 0. `restored` must
  // stay false until VideoPlayer confirms the resume attempt is done.
  it("does not save on pause while restored=false, even with a real position", () => {
    const { getByTestId } = render(<Harness restored={false} />);
    const video = getByTestId("video") as HTMLVideoElement;
    setMediaProps(video, { currentTime: 0, duration: 100 });

    video.dispatchEvent(new Event("pause"));

    expect(playback.saveWatchProgress).not.toHaveBeenCalled();
  });

  it("does not autosave every 10s while restored=false", async () => {
    const { getByTestId } = render(<Harness restored={false} />);
    const video = getByTestId("video") as HTMLVideoElement;
    setMediaProps(video, { currentTime: 0, duration: 100, paused: false });

    await vi.advanceTimersByTimeAsync(10_000);

    expect(playback.saveWatchProgress).not.toHaveBeenCalled();
  });

  it("does not save via sendBeacon on pagehide while restored=false", () => {
    const { getByTestId } = render(<Harness restored={false} />);
    const video = getByTestId("video") as HTMLVideoElement;
    setMediaProps(video, { currentTime: 0, duration: 100 });

    window.dispatchEvent(new Event("pagehide"));

    expect(playback.saveWatchProgressBeacon).not.toHaveBeenCalled();
  });

  it("does not save on play while restored=false", () => {
    const { getByTestId } = render(<Harness restored={false} />);
    const video = getByTestId("video") as HTMLVideoElement;
    setMediaProps(video, { currentTime: 0, duration: 100 });

    video.dispatchEvent(new Event("play"));

    expect(playback.saveWatchProgress).not.toHaveBeenCalled();
  });

  it("starts saving normally once restored flips to true", () => {
    const { getByTestId, rerender } = render(<Harness restored={false} />);
    const video = getByTestId("video") as HTMLVideoElement;
    setMediaProps(video, { currentTime: 219.76, duration: 581 });

    video.dispatchEvent(new Event("seeked"));
    expect(playback.saveWatchProgress).not.toHaveBeenCalled();

    rerender(<Harness restored={true} />);
    video.dispatchEvent(new Event("seeked"));

    expect(playback.saveWatchProgress).toHaveBeenCalledWith(
      expect.objectContaining({ position_seconds: 219.76 })
    );
  });
});

describe("useWatchProgress — identity payload shape", () => {
  it("includes season/episode for TV, omits them (null) for movies", () => {
    const { getByTestId, unmount } = render(<Harness mediaType="movie" />);
    const video = getByTestId("video") as HTMLVideoElement;
    setMediaProps(video, { currentTime: 1, duration: 100 });
    video.dispatchEvent(new Event("pause"));

    expect(playback.saveWatchProgress).toHaveBeenCalledWith(
      expect.objectContaining({ season_number: null, episode_number: null })
    );
    unmount();

    vi.clearAllMocks();
    const { getByTestId: getByTestId2 } = render(
      <Harness mediaType="tv" tmdbId={1399} seasonNumber={2} episodeNumber={5} />
    );
    const video2 = getByTestId2("video") as HTMLVideoElement;
    setMediaProps(video2, { currentTime: 1, duration: 100 });
    video2.dispatchEvent(new Event("pause"));

    expect(playback.saveWatchProgress).toHaveBeenCalledWith(
      expect.objectContaining({ media_type: "tv", season_number: 2, episode_number: 5 })
    );
  });
  it("records a visit the moment a TV episode mounts, even before restoration or any playback", () => {
    // Regression test: clicking an episode and closing it within a second
    // could leave no saved row at all (the `play` event never fires), so
    // the next visit showed the PREVIOUS episode as last watched. The
    // visit is recorded on mount, independent of `restored`.
    render(<Harness mediaType="tv" tmdbId={1396} seasonNumber={1} episodeNumber={9} restored={false} />);

    expect(playback.recordEpisodeVisit).toHaveBeenCalledWith(1396, 1, 9);
    expect(playback.saveWatchProgress).not.toHaveBeenCalled();
  });

  it("records the visit once per episode, not on every re-render", () => {
    const { rerender } = render(
      <Harness mediaType="tv" tmdbId={1396} seasonNumber={1} episodeNumber={9} />
    );
    rerender(<Harness mediaType="tv" tmdbId={1396} seasonNumber={1} episodeNumber={9} />);

    expect(playback.recordEpisodeVisit).toHaveBeenCalledTimes(1);
  });

  it("does not record a visit for a movie", () => {
    render(<Harness mediaType="movie" tmdbId={550} />);
    expect(playback.recordEpisodeVisit).not.toHaveBeenCalled();
  });
});


describe("useWatchProgress — Save watch progress setting", () => {
  it("off: no position is ever saved (not on play, pause, seek, interval or unmount)", async () => {
    const { getByTestId, unmount } = render(<Harness saveProgress={false} />);
    const video = getByTestId("video") as HTMLVideoElement;
    setMediaProps(video, { currentTime: 5, duration: 100, paused: false });
    video.dispatchEvent(new Event("play"));
    video.dispatchEvent(new Event("pause"));
    video.dispatchEvent(new Event("seeked"));
    await vi.advanceTimersByTimeAsync(30_000);
    unmount();
    expect(playback.saveWatchProgress).not.toHaveBeenCalled();
    expect(playback.saveWatchProgressBeacon).not.toHaveBeenCalled();
  });

  it("off: the 'opened' visit is still recorded, for movies and episodes, so Continue Watching keeps working", () => {
    render(<Harness saveProgress={false} />);
    expect(playback.recordMovieVisit).toHaveBeenCalledWith(550);
    render(<Harness saveProgress={false} mediaType="tv" tmdbId={1396} seasonNumber={2} episodeNumber={3} />);
    expect(playback.recordEpisodeVisit).toHaveBeenCalledWith(1396, 2, 3);
  });

  it("on: opening a movie records a visit once, and not an episode visit", () => {
    const { rerender } = render(<Harness />);
    rerender(<Harness />);
    expect(playback.recordMovieVisit).toHaveBeenCalledTimes(1);
    expect(playback.recordEpisodeVisit).not.toHaveBeenCalled();
  });

  it("switching it on part-way starts saving", async () => {
    const { getByTestId, rerender } = render(<Harness saveProgress={false} />);
    const video = getByTestId("video") as HTMLVideoElement;
    setMediaProps(video, { currentTime: 5, duration: 100, paused: false });
    rerender(<Harness saveProgress={true} />);
    video.dispatchEvent(new Event("pause"));
    expect(playback.saveWatchProgress).toHaveBeenCalledTimes(1);
  });
});
