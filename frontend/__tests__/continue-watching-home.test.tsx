import { describe, it, expect } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";

import { resumeHref, seasonEpisodeLabel, toContinueWatchingItems, Section } from "@/app/(main)/page";
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

describe("toContinueWatchingItems", () => {
  it("links every item straight to its resume point", () => {
    const items = toContinueWatchingItems([movie, episode]);
    expect(items[0].href).toBe("/watch/movie/603");
    expect(items[1].href).toBe("/watch/tv/1396/2/8");
  });

  it("gives a series item a season/episode poster badge", () => {
    const [series] = toContinueWatchingItems([episode]);
    expect(series.badge).toBe("S2:E8");
  });

  it("leaves a movie without a badge", () => {
    const [film] = toContinueWatchingItems([movie]);
    expect(film.badge).toBeUndefined();
  });

  it("keeps movies and series together in one list, in the order given", () => {
    const items = toContinueWatchingItems([episode, movie]);
    expect(items.map((i) => i.tmdb_id)).toEqual([1396, 603]);
  });
});

describe("Continue Watching card rendering", () => {
  it("shows the season/episode badge but keeps the normal year/type/rating meta row", () => {
    const items = toContinueWatchingItems([episode]);
    render(<MediaGrid items={items} />);

    expect(screen.getByText("S2:E8")).toBeInTheDocument(); // the poster badge
    // No separate "Watch Now — S2:E8" CTA line — that was removed in
    // favor of a single unified row with just the badge.
    expect(screen.queryByText(/Watch Now/)).not.toBeInTheDocument();
    expect(screen.getByText(/2008 · TV/)).toBeInTheDocument();
  });

  it("a movie in the same row shows no badge at all", () => {
    const items = toContinueWatchingItems([movie]);
    render(<MediaGrid items={items} />);

    expect(screen.queryByText(/^S\d+:E\d+$/)).not.toBeInTheDocument();
    expect(screen.getByText(/1999 · Movie/)).toBeInTheDocument();
  });
});

describe("Section's View All link", () => {
  it("renders a View All link when viewAllHref is given", () => {
    render(
      <Section
        title="Continue Watching"
        items={toContinueWatchingItems([movie])}
        error={null}
        viewAllHref="/continue-watching"
      />
    );
    const link = screen.getByRole("link", { name: "View All" });
    expect(link).toHaveAttribute("href", "/continue-watching");
  });

  it("renders no View All link when viewAllHref is omitted", () => {
    render(<Section title="Continue Watching" items={toContinueWatchingItems([movie])} error={null} />);
    expect(screen.queryByRole("link", { name: "View All" })).not.toBeInTheDocument();
  });
});
