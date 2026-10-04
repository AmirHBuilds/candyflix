import { describe, it, expect } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DetailSkeleton,
  EpisodeListSkeleton,
  GridPageSkeleton,
  HomeSkeleton,
  LoadingRegion,
  MediaGridSkeleton,
  PlayerSkeleton,
} from "@/components/Skeleton";
import MediaGrid, { MEDIA_GRID_CLASSES } from "@/components/MediaGrid";

import HomeLoading from "@/app/(main)/loading";
import MoviesLoading from "@/app/(main)/movies/loading";
import SeriesLoading from "@/app/(main)/series/loading";
import CandyBoxLoading from "@/app/(main)/candy-box/loading";
import ContinueLoading from "@/app/(main)/continue-watching/loading";
import MovieDetailLoading from "@/app/(main)/movie/[id]/loading";
import TvDetailLoading from "@/app/(main)/tv/[id]/loading";
import WatchLoading from "@/app/watch/loading";

describe("LoadingRegion", () => {
  it("is one polite 'Loading…' status for screen readers, with the placeholder blocks hidden", () => {
    render(
      <LoadingRegion>
        <div data-testid="block" />
      </LoadingRegion>
    );
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(region).toHaveTextContent("Loading…");
    expect(screen.getByTestId("block").closest("[aria-hidden='true']")).not.toBeNull();
  });
});

describe("skeleton layouts", () => {
  it("MediaGridSkeleton uses exactly the real grid's columns, so nothing jumps when content arrives", () => {
    const { container: sk } = render(<MediaGridSkeleton count={5} />);
    const { container: real } = render(<MediaGrid items={[]} />);
    expect(sk.firstElementChild!.className).toBe(MEDIA_GRID_CLASSES);
    expect(real.firstElementChild!.className).toBe(MEDIA_GRID_CLASSES);
    expect(sk.firstElementChild!.children).toHaveLength(5);
  });

  it("GridPageSkeleton / HomeSkeleton / DetailSkeleton / EpisodeListSkeleton / PlayerSkeleton each announce 'Loading…' once", () => {
    for (const ui of [
      <GridPageSkeleton key="g" />,
      <HomeSkeleton key="h" />,
      <DetailSkeleton key="d" />,
      <EpisodeListSkeleton key="e" />,
      <PlayerSkeleton key="p" />,
    ]) {
      const { unmount } = render(ui);
      expect(screen.getAllByRole("status")).toHaveLength(1);
      expect(screen.getByRole("status")).toHaveTextContent("Loading…");
      unmount();
    }
  });

  it("the detail skeleton keeps the same 12-unit-tall action row sizing as the real buttons (h-12)", () => {
    const { container } = render(<DetailSkeleton />);
    expect(container.querySelectorAll(".h-12").length).toBeGreaterThanOrEqual(2);
  });
});

describe("loading.tsx route files", () => {
  it.each([
    ["(main)/loading (home + fallback)", HomeLoading],
    ["movies", MoviesLoading],
    ["series", SeriesLoading],
    ["candy-box", CandyBoxLoading],
    ["continue-watching", ContinueLoading],
    ["movie/[id]", MovieDetailLoading],
    ["tv/[id]", TvDetailLoading],
    ["watch", WatchLoading],
  ])("%s renders a loading status", (_name, Loading) => {
    render(<Loading />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
  });
});

describe("motion CSS", () => {
  const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

  it("defines the entrance animations, which the calming rules below then switch off when asked", () => {
    expect(css).toMatch(/\.animate-fade-in\s*\{/);
    expect(css).toMatch(/\.animate-fade-up\s*\{/);
  });

  it("calms every animation/transition when the device asks to reduce motion — unless the person overrides it to Off", () => {
    const reduce = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduce).toContain('html:not([data-motion="off"])');
    expect(reduce).toContain("animation-duration: 0.01ms !important");
    expect(reduce).toContain("transition-duration: 0.01ms !important");
  });

  it("calms them always when the person sets Reduce motion to On", () => {
    const on = css.slice(css.indexOf('html[data-motion="on"] *'), css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(on).toContain("animation-duration: 0.01ms !important");
    expect(on).toContain("transition-duration: 0.01ms !important");
  });
});

describe("MediaGrid entrance stagger", () => {
  it("fades each card up with a short stagger that is capped, so long lists aren't slow", () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      tmdb_id: i + 1,
      media_type: "movie" as const,
      title: `T${i + 1}`,
      year: "2026",
      poster_path: null,
      backdrop_path: null,
      rating: null,
    }));
    const { container } = render(<MediaGrid items={items} />);
    const cells = Array.from(container.firstElementChild!.children) as HTMLElement[];
    expect(cells).toHaveLength(20);
    expect(cells.every((c) => c.classList.contains("animate-fade-up"))).toBe(true);
    expect(cells[0].style.animationDelay).toBe("0ms");
    expect(cells[1].style.animationDelay).toBe("30ms");
    expect(cells[19].style.animationDelay).toBe("330ms"); // capped at index 11
  });
});
