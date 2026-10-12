import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const hlsInstances: Array<{ loadSource: ReturnType<typeof vi.fn>; attachMedia: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }> = [];
vi.mock("hls.js", () => {
  class FakeHls {
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
    constructor() {
      hlsInstances.push(this);
    }
  }
  return { default: FakeHls };
});
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
vi.mock("@/lib/resolve", async () => {
  const actual = await vi.importActual<typeof import("@/lib/resolve")>("@/lib/resolve");
  return { ...actual, startResolve: vi.fn(), getResolveState: vi.fn(), requestDownload: vi.fn() };
});
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

import ResolverPlayer from "@/components/player/ResolverPlayer";
import SourceMenu from "@/components/player/SourceMenu";
import { SettingsProvider } from "@/components/SettingsProvider";
import * as resolve from "@/lib/resolve";
import type { ResolveState, StreamState } from "@/lib/resolve";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import type { PlaybackSource } from "@/lib/playback";

const stream = (id: string, quality: string, over: Partial<StreamState> = {}): StreamState => ({
  stream_id: id, quality, rank: parseInt(quality) || 0, state: "idle", progress: null, library_id: null, play_url: null, error: null, ...over,
});
const state = (over: Partial<ResolveState> = {}): ResolveState => ({
  task_id: "tsk_1", status: "running", version: 1, sources_total: 2, sources_done: 1, queue_position: null,
  sources: [{ name: "Vertex", starred: true, status: "ok", error: null, streams: [stream("b", "800p"), stream("a", "534p")] }],
  subtitles: [], auto_stream_id: null, ...over,
});
const withDownload = (over: Partial<StreamState>): ResolveState =>
  state({
    auto_stream_id: "b",
    sources: [{ name: "Vertex", starred: true, status: "ok", error: null, streams: [stream("b", "800p", { state: "downloading", progress: 10, play_url: "/api/resolve/relay?u=B" }), stream("a", "534p", over)] }],
  });

const source: PlaybackSource = { source_type: "resolver", url: "", subtitles: [], resume_position_seconds: null, video_settings: {} };
const identity = { tmdbId: 550, mediaType: "movie" as const };

beforeEach(() => {
  vi.clearAllMocks();
  hlsInstances.length = 0;
  Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => 4 });
  Object.defineProperty(HTMLMediaElement.prototype, "duration", { configurable: true, get: () => 100 });
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined) as never;
  HTMLMediaElement.prototype.pause = vi.fn();
  HTMLMediaElement.prototype.load = vi.fn();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "" }));
});
afterEach(() => vi.unstubAllGlobals());

function mount() {
  return render(
    <SettingsProvider initial={{ ...DEFAULT_SETTINGS, playback: { ...DEFAULT_SETTINGS.playback, autoplay_on_open: false } }}>
      <ResolverPlayer source={source} title="Fight Club" identity={identity} backHref="/movie/550" artwork="https://image.tmdb.org/t/p/w1280/x.jpg" />
    </SettingsProvider>
  );
}

describe("SourceMenu", () => {
  const picker = (over = {}) => ({
    sources: withDownload({ state: "downloading", progress: 42, play_url: null }).sources,
    playingId: "b", searching: false, onSelect: vi.fn(), ...over,
  });

  it("lists sources and qualities with the progress filling the row", () => {
    render(<SourceMenu picker={picker()} getTime={() => 12} />);
    fireEvent.click(screen.getByLabelText("Sources and quality"));
    expect(screen.getByText("Vertex")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.getByLabelText(/^800p, playing/)).toHaveAttribute("aria-current", "true");
    const fills = screen.getAllByTestId("source-fill");
    expect(fills.some((f) => f.style.width === "42%")).toBe(true);
  });

  it("a click reports the stream and where the video is", () => {
    const p = picker();
    render(<SourceMenu picker={p} getTime={() => 77} />);
    fireEvent.click(screen.getByLabelText("Sources and quality"));
    fireEvent.click(screen.getByLabelText(/^534p/));
    expect(p.onSelect).toHaveBeenCalledWith("a", 77);
  });

  it("says when it is still searching and when nothing is there yet", () => {
    render(<SourceMenu picker={picker({ sources: [], searching: true })} getTime={() => 0} />);
    fireEvent.click(screen.getByLabelText("Sources and quality"));
    expect(screen.getByText("No sources yet…")).toBeInTheDocument();
    expect(screen.getByText("Still looking for more sources…")).toBeInTheDocument();
  });
});

describe("ResolverPlayer", () => {
  it("shows the loading screen with the artwork, then the video as HLS", async () => {
    vi.mocked(resolve.startResolve).mockResolvedValue(state());
    vi.mocked(resolve.requestDownload).mockResolvedValue(withDownload({}));
    vi.mocked(resolve.getResolveState).mockImplementation(() => new Promise(() => {}));
    const { container } = mount();
    expect(screen.getByTestId("player-loading")).toHaveAttribute("data-phase", "finding");
    expect(container.querySelector("img")).toHaveAttribute("src", "https://image.tmdb.org/t/p/w1280/x.jpg");
    await waitFor(() => expect(container.querySelector("video")).not.toBeNull());
    expect(resolve.requestDownload).toHaveBeenCalledWith("tsk_1", null); // the first answer had no download yet
    expect(container.querySelector("video")).not.toHaveAttribute("src");
    await waitFor(() => expect(hlsInstances.length).toBe(1));
    expect(hlsInstances[0].loadSource).toHaveBeenCalledWith(expect.stringContaining("/api/resolve/relay?u=B"));
    expect(screen.getByLabelText("Sources and quality")).toBeInTheDocument();
  });

  it("says when the search is waiting in line", async () => {
    vi.mocked(resolve.startResolve).mockResolvedValue(state({ sources: [], queue_position: 2 }));
    vi.mocked(resolve.getResolveState).mockImplementation(() => new Promise(() => {}));
    mount();
    expect(await screen.findByText("Waiting in line (2)…")).toBeInTheDocument();
  });

  it("says so when nothing was found, and tries again", async () => {
    vi.mocked(resolve.startResolve).mockResolvedValue(state({ status: "done", sources: [] }));
    mount();
    await waitFor(() => expect(screen.getByTestId("player-loading")).toHaveAttribute("data-phase", "failed"));
    expect(screen.getByText(/couldn't get a video/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Try again"));
    await waitFor(() => expect(resolve.startResolve).toHaveBeenCalledTimes(2));
  });

  it("a service error shows up as a failure with its message", async () => {
    vi.mocked(resolve.startResolve).mockRejectedValue(new Error("The video service isn't reachable right now."));
    mount();
    await waitFor(() => expect(screen.getByText("The video service isn't reachable right now.")).toBeInTheDocument());
  });

  it("clicking an idle quality starts its download and keeps playing; clicking it once playable switches", async () => {
    vi.mocked(resolve.startResolve).mockResolvedValue(withDownload({}));
    vi.mocked(resolve.getResolveState).mockImplementation(() => new Promise(() => {}));
    vi.mocked(resolve.requestDownload).mockResolvedValue(withDownload({ state: "downloading", progress: 0, play_url: null }));
    const { container } = mount();
    await waitFor(() => expect(container.querySelector("video")).not.toBeNull());

    fireEvent.click(screen.getByLabelText("Sources and quality"));
    fireEvent.click(screen.getByLabelText(/^534p/));
    expect(resolve.requestDownload).toHaveBeenCalledWith("tsk_1", "a");
    await waitFor(() => expect(screen.getByLabelText(/^534p, downloading/)).toBeInTheDocument());
    expect(hlsInstances.length).toBe(1); // still the first video

    // it becomes playable (the next poll), another click plays it
    vi.mocked(resolve.getResolveState).mockResolvedValue(withDownload({ state: "downloading", progress: 8, play_url: "/api/resolve/relay?u=A" }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1700));
    });
    fireEvent.click(screen.getByLabelText(/^534p, downloading 8 percent, click to play/));
    await waitFor(() => expect(hlsInstances.length).toBe(2));
    expect(hlsInstances[1].loadSource).toHaveBeenCalledWith(expect.stringContaining("relay?u=A"));
    expect(hlsInstances[0].destroy).toHaveBeenCalled();
  }, 15000);

  it("adds the resolver's subtitles to the player", async () => {
    vi.mocked(resolve.startResolve).mockResolvedValue({
      ...withDownload({}),
      subtitles: [{ language: "en", label: "English", url: "/api/resolve/relay?u=S", format: "vtt", source: "Vertex", default: false }],
    });
    vi.mocked(resolve.getResolveState).mockImplementation(() => new Promise(() => {}));
    const { container } = mount();
    await waitFor(() => expect(container.querySelector("video")).not.toBeNull());
    fireEvent.click(screen.getByLabelText("Settings"));
    fireEvent.click(screen.getByText("Subtitles"));
    expect(await screen.findByText(/English · Vertex/)).toBeInTheDocument();
  });
});
