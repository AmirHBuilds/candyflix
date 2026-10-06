import { existsSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OpenSubtitlesBrowser, {
  formatDownloads,
  groupByLanguage,
  languageCodeForQuery,
} from "@/components/player/OpenSubtitlesBrowser";
import SubtitleSettingsPanel from "@/components/player/SubtitleSettingsPanel";
import { DEFAULT_SUBTITLE_SETTINGS } from "@/components/player/subtitle-settings";
import { FLAG_CODES, flagCodeFor } from "@/lib/flags";
import type { OnlineSubtitleResult, SubtitleTrack } from "@/lib/playback";

vi.mock("@/lib/playback", async (orig) => {
  const real = await orig<typeof import("@/lib/playback")>();
  return { ...real, searchOnlineSubtitles: vi.fn(), downloadOnlineSubtitle: vi.fn() };
});
vi.mock("@/lib/subtitle-sync", async (orig) => {
  const real = await orig<typeof import("@/lib/subtitle-sync")>();
  return {
    ...real,
    getSyncStatus: vi.fn().mockResolvedValue({ state: "idle", percent: 0, stage: null, message: null, track: null }),
    startSync: vi.fn(),
  };
});
import { downloadOnlineSubtitle, searchOnlineSubtitles } from "@/lib/playback";

const identity = { mediaType: "tv" as const, tmdbId: 1, seasonNumber: 1, episodeNumber: 2 };
const r = (file_id: number, language: string, label: string, downloads: number, release: string, extra = {}): OnlineSubtitleResult => ({
  file_id,
  language,
  label,
  release,
  downloads,
  rating: null,
  hearing_impaired: false,
  ...extra,
});
const RESULTS = [
  r(1, "fa", "Persian", 500, "Show.S01E02.WEB"),
  r(2, "en", "English", 9000, "Show.S01E02.1080p.BluRay.x264-GROUP"),
  r(3, "en", "English", 20000, "Show.S01E02.720p.WEB", { hearing_impaired: true }),
  r(4, "pt-BR", "Portuguese (Brazil)", 3000, "Show.S01E02.pt"),
  r(5, "en", "English", 100, "Show.S01E02.cam"),
];

beforeEach(() => {
  vi.mocked(searchOnlineSubtitles).mockReset().mockResolvedValue({ results: RESULTS, hasMore: false });
  vi.mocked(downloadOnlineSubtitle).mockReset();
});
afterEach(cleanup);

describe("flags", () => {
  it("picks sensible flags", () => {
    expect(flagCodeFor("en")).toBe("gb");
    expect(flagCodeFor("fa")).toBe("ir");
    expect(flagCodeFor("pt-BR")).toBe("br");
    expect(flagCodeFor("pt-PT")).toBe("pt");
    expect(flagCodeFor("zh-TW")).toBe("tw");
    expect(flagCodeFor("xx")).toBeNull();
    expect(flagCodeFor("und")).toBeNull();
  });
  it("has an image file for every flag it can return", () => {
    const missing = FLAG_CODES.filter((c) => !existsSync(join(__dirname, "..", "public", "flags", `${c}.svg`)));
    expect(missing).toEqual([]);
  });
});

describe("helpers", () => {
  it("groups by language, most downloaded first inside, best group first", () => {
    const groups = groupByLanguage(RESULTS);
    expect(groups.map((g) => g.language)).toEqual(["en", "pt-BR", "fa"]);
    expect(groups[0].items.map((i) => i.file_id)).toEqual([3, 2, 5]);
  });
  it("pins English first even when another language has more downloads", () => {
    const groups = groupByLanguage([r(1, "fa", "Persian", 99999, "x"), r(2, "en", "English", 5, "y")]);
    expect(groups.map((g) => g.language)).toEqual(["en", "fa"]);
  });
  it("turns language names into a language filter and leaves release words alone", () => {
    expect(languageCodeForQuery("persian")).toBe("fa");
    expect(languageCodeForQuery("Persian")).toBe("fa");
    expect(languageCodeForQuery("fa")).toBe("fa");
    expect(languageCodeForQuery("pt-br")).toBe("pt-br");
    expect(languageCodeForQuery("bluray")).toBeNull();
    expect(languageCodeForQuery("e")).toBeNull();
  });
  it("shortens download counts", () => {
    expect([950, 1500, 20000, 1200000].map(formatDownloads)).toEqual(["950", "1.5k", "20k", "1.2M"]);
  });
});

describe("OpenSubtitlesBrowser", () => {
  it("lists results grouped by language with a flag on each row", async () => {
    render(<OpenSubtitlesBrowser identity={identity} activeUrl={null} onPicked={vi.fn()} />);
    const english = await screen.findByRole("region", { name: "English" });
    expect(within(english).getAllByRole("button")).toHaveLength(3);
    expect(english.querySelectorAll('[data-flag="gb"]')).toHaveLength(3);
    expect(screen.getByRole("region", { name: "Persian" }).querySelector('[data-flag="ir"]')).toBeTruthy();
    // order of groups on the page
    expect(screen.getAllByRole("region").map((s) => s.getAttribute("aria-label"))).toEqual(["English", "Portuguese (Brazil)", "Persian"]);
    expect(within(english).getByText("20k")).toBeTruthy();
    expect(within(english).getByText("HI")).toBeTruthy();
  });

  it("downloads and hands over the pick", async () => {
    const track: SubtitleTrack = { language: "fa", label: "Persian", url: "/subtitle-cache/tv-1-1-2-fa-1.srt", format: "srt", origin: "opensubtitles" };
    vi.mocked(downloadOnlineSubtitle).mockResolvedValue(track);
    const onPicked = vi.fn();
    render(<OpenSubtitlesBrowser identity={identity} activeUrl={null} onPicked={onPicked} />);
    const persian = await screen.findByRole("region", { name: "Persian" });
    fireEvent.click(within(persian).getByRole("button"));
    await waitFor(() => expect(onPicked).toHaveBeenCalledWith(track));
    expect(vi.mocked(downloadOnlineSubtitle).mock.calls[0][0]).toMatchObject({ fileId: 1, language: "fa" });
  });

  it("marks the subtitle in use", async () => {
    render(<OpenSubtitlesBrowser identity={identity} activeUrl="/subtitle-cache/tv-1-1-2-en-3.srt" onPicked={vi.fn()} />);
    const english = await screen.findByRole("region", { name: "English" });
    const current = within(english).getAllByRole("button").filter((b) => b.getAttribute("aria-current") === "true");
    expect(current).toHaveLength(1);
    expect(within(current[0]).getByText("HI")).toBeTruthy();
  });

  it("searches OpenSubtitles from the same menu: a language name becomes a language filter, other words a release search", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<OpenSubtitlesBrowser identity={identity} activeUrl={null} onPicked={vi.fn()} />);
    await screen.findByRole("region", { name: "English" });
    const box = screen.getByRole("searchbox", { name: "Search OpenSubtitles" });

    fireEvent.change(box, { target: { value: "persian" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(vi.mocked(searchOnlineSubtitles).mock.calls.at(-1)![0]).toMatchObject({ language: "fa", query: undefined, page: 1 });

    fireEvent.change(box, { target: { value: "bluray" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(vi.mocked(searchOnlineSubtitles).mock.calls.at(-1)![0]).toMatchObject({ language: undefined, query: "bluray" });
    vi.useRealTimers();
  });

  it("says so when nothing matches, and offers retry on errors", async () => {
    vi.mocked(searchOnlineSubtitles).mockRejectedValueOnce(new Error("OpenSubtitles is down"));
    render(<OpenSubtitlesBrowser identity={identity} activeUrl={null} onPicked={vi.fn()} />);
    expect(await screen.findByText("OpenSubtitles is down")).toBeTruthy();
    vi.mocked(searchOnlineSubtitles).mockResolvedValueOnce({ results: [], hasMore: false });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No subtitles found for this title.")).toBeTruthy();
  });
});

describe("SubtitleSettingsPanel tabs", () => {
  const own: SubtitleTrack = { language: "en", label: "English", url: "/subtitle-cache/own.srt", format: "srt", origin: "source" };
  const fromOs: SubtitleTrack = { language: "en", label: "English", url: "/subtitle-cache/tv-1-1-2-en-3.srt", format: "srt", origin: "opensubtitles" };
  const synced: SubtitleTrack = { language: "fa", label: "Persian", url: "/subtitle-cache/sync-a-b.srt", format: "srt", origin: "opensubtitles", synced: true };

  function panel(over: Partial<React.ComponentProps<typeof SubtitleSettingsPanel>> = {}) {
    const props = {
      tracks: [] as SubtitleTrack[],
      listedTracks: [] as SubtitleTrack[],
      selectedLanguage: null,
      onSelectLanguage: vi.fn(),
      settings: DEFAULT_SUBTITLE_SETTINGS,
      onChange: vi.fn(),
      identity,
      onTrackAdded: vi.fn(),
      ...over,
    };
    render(<SubtitleSettingsPanel {...props} />);
    return props;
  }
  const tabNames = () => screen.getAllByRole("tab").map((t) => t.textContent?.replace(/\d+$/, ""));

  it("shows Source, OpenSubtitles and Style, and no Synced tab while nothing is synced", () => {
    panel();
    expect(tabNames()).toEqual(["Source", "OpenSubtitles", "Style"]);
  });

  it("adds a Synced tab once a synced subtitle exists", () => {
    panel({ tracks: [synced], listedTracks: [synced] });
    expect(tabNames()).toEqual(["Source", "OpenSubtitles", "Synced", "Style"]);
  });

  it("starts on OpenSubtitles when the video has no subtitles of its own, and says so on Source", async () => {
    panel();
    expect(screen.getByRole("tab", { name: "OpenSubtitles" }).getAttribute("aria-selected")).toBe("true");
    await screen.findByRole("region", { name: "English" });
    fireEvent.click(screen.getByRole("tab", { name: /^Source/ }));
    expect(screen.getByText(/doesn.t come with subtitles of its own/)).toBeTruthy();
  });

  it("lists the video's own subtitles under Source with their flag, and picks one", () => {
    const props = panel({ tracks: [own], listedTracks: [own] });
    expect(screen.getByRole("tab", { name: /^Source/ }).getAttribute("aria-selected")).toBe("true");
    const row = screen.getByRole("button", { name: /English/ });
    expect(row.querySelector('[data-flag="gb"]')).toBeTruthy();
    fireEvent.click(row);
    expect(props.onTrackAdded).toHaveBeenCalledWith(own);
  });

  it("opens on the tab of the subtitle in use, and shows it in the header with a Turn off button", () => {
    const props = panel({ tracks: [fromOs], listedTracks: [fromOs], selectedLanguage: "en" });
    expect(screen.getByRole("tab", { name: "OpenSubtitles" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByText("English").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    expect(props.onSelectLanguage).toHaveBeenCalledWith(null);
  });

  it("offers Sync subtitle for an unsynced subtitle in use, not for a synced one", async () => {
    panel({ tracks: [fromOs], listedTracks: [fromOs], selectedLanguage: "en" });
    expect(await screen.findByRole("button", { name: "Sync subtitle" })).toBeTruthy();
    cleanup();
    panel({ tracks: [synced], listedTracks: [synced], selectedLanguage: "fa" });
    expect(screen.queryByRole("button", { name: "Sync subtitle" })).toBeNull();
    expect(screen.getByText(/Matched to this video/)).toBeTruthy();
  });

  it("keeps the look and timing controls on the Style tab", () => {
    panel({ tracks: [own], listedTracks: [own], selectedLanguage: "en" });
    fireEvent.click(screen.getByRole("tab", { name: "Style" }));
    expect(screen.getByText("Timing offset")).toBeTruthy();
    expect(screen.getByText("Sample subtitle")).toBeTruthy();
  });
});
