import { describe, it, expect } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";

import {
  resumeHref,
  seasonEpisodeLabel,
  toGeneralContinueWatchingItems,
  toSeriesContinueWatchingItems,
} from "@/app/(main)/page";
import MediaGrid from "@/components/MediaGrid";
import type { ContinueWatchingItem } from "@/lib/continue-watching-server";

// These act on the raw ContinueWatchingItemOut shape the backend
// returns (see schemas/continue_watching.py) — no backend or TMDB
// access needed, same "pure component/logic" approach as
// home-section-cap.test.tsx and media-grid.test.tsx.

const movie: ContinueWatchingItem = {
  tmdb_id: 603,
  media_type: "movie",
  title: "The Matrix",
  year: "1999",
  poster_path: "/matrix.jpg",
  backdrop_path: null,
  rating: 8.7,
  season_number: null,
  episode_number: null,
  position_seconds: 100,
  duration_seconds: 8000,
};

const episode: ContinueWatchingItem = {
  tmdb_id: 1396,
  media_type: "tv",
  title: "Breaking Bad",
  year: "2008",
  poster_path: "/bb.jpg",
  backdrop_path: null,
  rating: 9.5,
  season_number: 2,
  episode_number: 8,
  position_seconds: 300,
  duration_seconds: 2700,
};

describe("resumeHref", () => {
  it("points a movie straight at its watch page", () => {
    expect(resumeHref(movie)).toBe("/watch/movie/603");
  });

  it("points a TV item at its exact remembered season/episode", () => {
    expect(resumeHref(episode)).toBe("/watch/tv/1396/2/8");
  });
});

describe("seasonEpisodeLabel", () => {
  it("formats a TV item's resume point as S{season}:E{episode}", () => {
    expect(seasonEpisodeLabel(episode)).toBe("S2:E8");
  });

  it("is null for a movie (no season/episode to show)", () => {
    expect(seasonEpisodeLabel(movie)).toBeNull();
  });
});

describe("toGeneralContinueWatchingItems", () => {
  it("links every item straight to its resume point, with no badge or CTA", () => {
    const [general] = toGeneralContinueWatchingItems([episode]);
    expect(general.href).toBe("/watch/tv/1396/2/8");
    expect(general.badge).toBeUndefined();
    expect(general.cta).toBeUndefined();
  });

  it("includes both movies and series", () => {
    const items = toGeneralContinueWatchingItems([movie, episode]);
    expect(items.map((i) => i.tmdb_id)).toEqual([603, 1396]);
  });
});

describe("toSeriesContinueWatchingItems", () => {
  it("excludes movies — this section is series-only", () => {
    const items = toSeriesContinueWatchingItems([movie, episode]);
    expect(items).toHaveLength(1);
    expect(items[0].tmdb_id).toBe(1396);
  });

  it("shows the exact resume point as both a badge and a hinted CTA", () => {
    const [series] = toSeriesContinueWatchingItems([episode]);
    expect(series.badge).toBe("S2:E8");
    expect(series.cta).toBe("Watch Now — S2:E8");
    expect(series.href).toBe("/watch/tv/1396/2/8");
  });
});

describe("Continue Watching series card rendering", () => {
  it("renders the resume-hinting CTA text instead of the usual year/type/rating row", () => {
    const items = toSeriesContinueWatchingItems([episode]);
    render(<MediaGrid items={items} />);

    expect(screen.getByText("Watch Now — S2:E8")).toBeInTheDocument();
    expect(screen.getByText("S2:E8")).toBeInTheDocument(); // the poster badge
    expect(screen.queryByText(/2008 · TV/)).not.toBeInTheDocument();
  });
});
