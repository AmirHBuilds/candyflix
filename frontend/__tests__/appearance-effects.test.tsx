import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

import { SettingsProvider } from "@/components/SettingsProvider";
import MediaCard from "@/components/MediaCard";
import MediaRow from "@/components/MediaRow";
import Overview from "@/components/Overview";
import HeroCarousel from "@/components/HeroCarousel";
import SeasonBrowser from "@/components/SeasonBrowser";
import { Section } from "@/app/(main)/page";
import { overviewForLength, type MediaItem } from "@/lib/media";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings";

vi.mock("@/lib/watchlist", async () => {
  const actual = await vi.importActual<typeof import("@/lib/watchlist")>("@/lib/watchlist");
  return { ...actual, getWatchlistStatus: vi.fn().mockResolvedValue(false) };
});
vi.mock("@/lib/playback", async () => {
  const actual = await vi.importActual<typeof import("@/lib/playback")>("@/lib/playback");
  return { ...actual, getLatestTVWatchProgress: vi.fn().mockResolvedValue(null), getSeasonWatchProgress: vi.fn().mockResolvedValue([]) };
});
vi.mock("@/lib/media", async () => {
  const actual = await vi.importActual<typeof import("@/lib/media")>("@/lib/media");
  return {
    ...actual,
    getSeason: vi.fn().mockResolvedValue({
      tv_id: 1,
      season_number: 1,
      name: "Season 1",
      episodes: [
        { episode_number: 1, name: "Pilot", overview: "The very first episode of the show, in which everything begins.", still_path: null, air_date: null, runtime_minutes: null },
        { episode_number: 12, name: "Finale", overview: "It ends.", still_path: null, air_date: null, runtime_minutes: null },
      ],
    }),
  };
});

const withAppearance = (a: Partial<Settings["appearance"]>): Settings => ({
  ...DEFAULT_SETTINGS,
  appearance: { ...DEFAULT_SETTINGS.appearance, ...a },
});
// The provider keeps its initial settings, so a rerender with different
// settings needs a different key to start from them afresh.
const wrap = (a: Partial<Settings["appearance"]>, ui: React.ReactNode) => (
  <SettingsProvider key={JSON.stringify(a)} initial={withAppearance(a)}>
    {ui}
  </SettingsProvider>
);

const item = (n: number, over: Partial<MediaItem> = {}): MediaItem => ({
  tmdb_id: n,
  media_type: "movie",
  title: `Title ${n}`,
  year: "2020",
  poster_path: null,
  backdrop_path: null,
  rating: 7.5,
  overview: "First sentence is here. Second sentence follows it with more detail. Third sentence goes on and on to make this longer than any short budget could hold at all.",
  ...over,
});

describe("overviewForLength", () => {
  const text = item(1).overview!;
  it("standard keeps today's behaviour", () => expect(overviewForLength(text, "standard", 200)).toBe(text));
  it("short is shorter, ending on a sentence", () => {
    const two = "This first sentence is long enough. A second sentence that runs on for quite a while longer than the budget allows for.";
    expect(overviewForLength(two, "short", 100)).toBe("This first sentence is long enough.");
    expect(overviewForLength(two, "standard", 100).length).toBeGreaterThan("This first sentence is long enough.".length);
  });
  it("full is the whole text", () => expect(overviewForLength("x".repeat(900), "full")).toHaveLength(900));
  it("leaves empty text alone", () => expect(overviewForLength("", "short")).toBe(""));
});

describe("Overview component", () => {
  it("follows the description-length setting", () => {
    const long = "A. ".repeat(10) + "Z".repeat(400);
    const { rerender } = render(wrap({ description_length: "full" }, <Overview text={long} />));
    expect(screen.getByText(/Z{400}/)).toBeInTheDocument();
    rerender(wrap({ description_length: "short" }, <Overview text={long} />));
    expect(screen.queryByText(/Z{400}/)).toBeNull();
  });
});

describe("MediaCard", () => {
  it("shows year and rating by default", () => {
    render(<MediaCard item={item(1)} />);
    expect(screen.getByText(/2020 · Movie/)).toBeInTheDocument();
    expect(screen.getByText(/★ 7.5/)).toBeInTheDocument();
  });
  it("hides the rating and/or year when switched off", () => {
    render(wrap({ show_ratings: false, show_years: false }, <MediaCard item={item(1)} />));
    expect(screen.queryByText(/★/)).toBeNull();
    expect(screen.queryByText(/2020/)).toBeNull();
    expect(screen.getByText("Movie")).toBeInTheDocument();
  });
});

describe("Home Section layouts", () => {
  const items = Array.from({ length: 30 }, (_, i) => item(i + 1));
  it("honours the titles-per-section value", () => {
    render(<Section title="T" items={items} error={null} max={12} />);
    expect(screen.getAllByRole("link")).toHaveLength(12);
  });
  it("renders a swipeable row in 'rows' layout, a grid otherwise", () => {
    const { rerender, container } = render(<Section title="Popular" items={items} error={null} layout="rows" />);
    expect(screen.getByRole("list", { name: "Popular" })).toBeInTheDocument();
    expect(container.querySelector(".snap-x")).not.toBeNull();
    rerender(<Section title="Popular" items={items} error={null} />);
    expect(screen.queryByRole("list", { name: "Popular" })).toBeNull();
  });
});

describe("MediaRow", () => {
  it("scrolls by most of a page with the arrow buttons", () => {
    render(<MediaRow label="Row" items={[item(1), item(2)]} />);
    const list = screen.getByRole("list", { name: "Row" });
    Object.defineProperty(list, "clientWidth", { value: 1000 });
    list.scrollBy = vi.fn() as unknown as typeof list.scrollBy;
    fireEvent.click(screen.getByRole("button", { name: "Scroll Row right" }));
    expect(list.scrollBy).toHaveBeenCalledWith({ left: 850, behavior: "smooth" });
    fireEvent.click(screen.getByRole("button", { name: "Scroll Row left" }));
    expect(list.scrollBy).toHaveBeenLastCalledWith({ left: -850, behavior: "smooth" });
  });
});

describe("HeroCarousel settings", () => {
  it("renders nothing when the banner is turned off", () => {
    const { container } = render(wrap({ hero_enabled: false }, <HeroCarousel items={[item(1)]} />));
    expect(container.querySelector("section")).toBeNull();
  });

  it("rotates at the chosen interval", () => {
    vi.useFakeTimers();
    try {
      render(wrap({ hero_interval_seconds: 3 }, <HeroCarousel items={[item(1), item(2)]} />));
      const active = () => screen.getAllByText(/^Title \d$/).map((el) => el.closest("[aria-hidden]")!.getAttribute("aria-hidden"));
      expect(active()).toEqual(["false", "true"]);
      act(() => void vi.advanceTimersByTime(3000));
      expect(active()).toEqual(["true", "false"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows more of the synopsis when description length is 'full'", () => {
    const long = "Start. " + "word ".repeat(120);
    const { rerender } = render(wrap({ description_length: "standard" }, <HeroCarousel items={[item(1, { overview: long })]} />));
    const standard = screen.getByText(/^Start\./).textContent!.length;
    rerender(wrap({ description_length: "full" }, <HeroCarousel items={[item(1, { overview: long })]} />));
    expect(screen.getByText(/^Start\./).textContent!.length).toBeGreaterThan(standard);
  });
});

describe("SeasonBrowser episode style", () => {
  const seasons = [{ season_number: 1, name: "Season 1", episode_count: 2, poster_path: null }];

  it("rows show the summary", async () => {
    render(wrap({ episode_view: "list" }, <SeasonBrowser tvId={1} seasons={seasons} />));
    expect(await screen.findByText(/very first episode/)).toBeInTheDocument();
  });

  it("compact blocks show the number and name, in an adaptive grid, and still link to the episode", async () => {
    const { container } = render(wrap({ episode_view: "blocks" }, <SeasonBrowser tvId={1} seasons={seasons} />));
    const link = (await screen.findByText("Finale")).closest("a")!;
    expect(link).toHaveAttribute("href", "/watch/tv/1/1/12");
    expect(link).toHaveTextContent("12");
    expect(screen.queryByText(/very first episode/)).toBeNull();
    expect(container.querySelector("ul")!.className).toContain("auto-fill");
  });

  it("shorter descriptions clamp to one line, full to none", async () => {
    const { rerender } = render(wrap({ description_length: "short" }, <SeasonBrowser tvId={1} seasons={seasons} />));
    expect((await screen.findByText(/very first episode/)).className).toContain("line-clamp-1");
    rerender(wrap({ description_length: "full" }, <SeasonBrowser tvId={1} seasons={seasons} />));
    expect((await screen.findByText(/very first episode/)).className).not.toContain("line-clamp");
  });
});
