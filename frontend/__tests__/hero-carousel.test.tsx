import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";

import HeroCarousel from "@/components/HeroCarousel";
import * as playback from "@/lib/playback";
import type { MediaItem } from "@/lib/media";

vi.mock("@/lib/watchlist", async () => {
  const actual = await vi.importActual<typeof import("@/lib/watchlist")>("@/lib/watchlist");
  return { ...actual, getWatchlistStatus: vi.fn().mockResolvedValue(false) };
});
vi.mock("@/lib/playback", async () => {
  const actual = await vi.importActual<typeof playback>("@/lib/playback");
  return { ...actual, getLatestTVWatchProgress: vi.fn().mockResolvedValue(null) };
});

const item = (over: Partial<MediaItem>): MediaItem => ({
  tmdb_id: 1396,
  media_type: "tv",
  title: "Breaking Bad",
  year: "2008",
  poster_path: null,
  backdrop_path: null,
  rating: 8.9,
  overview: "A chemistry teacher diagnosed with cancer turns to manufacturing drugs.",
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("HeroCarousel — description under the title", () => {
  it("shows the short synopsis below the title for a TV show", () => {
    render(<HeroCarousel items={[item({})]} />);
    const title = screen.getByText("Breaking Bad");
    const description = screen.getByText(/chemistry teacher/);
    expect(description).toBeInTheDocument();
    // Title comes first in the document, then the description.
    expect(title.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("works for movies as well", () => {
    render(<HeroCarousel items={[item({ media_type: "movie", title: "Inception", overview: "A thief steals secrets through dreams." })]} />);
    expect(screen.getByText("A thief steals secrets through dreams.")).toBeInTheDocument();
  });

  it("trims a long synopsis to a sentence or so instead of a wall of text", () => {
    const long =
      "First sentence is short. " + "Then a much longer second sentence that keeps going and going. ".repeat(10);
    render(<HeroCarousel items={[item({ overview: long })]} />);
    const text = screen.getByText(/First sentence/).textContent!;
    expect(text.length).toBeLessThanOrEqual(181);
    expect(text.length).toBeLessThan(long.length);
  });

  it("clamps to 2 lines on phones and 3 from sm up", () => {
    render(<HeroCarousel items={[item({})]} />);
    expect(screen.getByText(/chemistry teacher/)).toHaveClass("line-clamp-2", "sm:line-clamp-3");
  });

  it.each([[null], [undefined], [""]])("renders no empty paragraph when the overview is %j", (overview) => {
    const { container } = render(<HeroCarousel items={[item({ overview })]} />);
    expect(screen.getByText("Breaking Bad")).toBeInTheDocument();
    expect(container.querySelectorAll("p.line-clamp-2")).toHaveLength(0);
  });
});
