import { describe, it, expect } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";

import MediaGrid from "@/components/MediaGrid";
import type { MediaItem } from "@/lib/media";

// MediaGrid takes items as a plain prop, so this test needs no backend
// or TMDB access — it's a pure component test with mock data.

function makeItems(count: number): MediaItem[] {
  return Array.from({ length: count }, (_, i) => ({
    tmdb_id: i + 1,
    media_type: i % 2 === 0 ? "movie" : "tv",
    title: `Title ${i + 1}`,
    year: "2026",
    poster_path: `/poster-${i + 1}.jpg`,
    backdrop_path: null,
    rating: 7.5,
  }));
}

describe("MediaGrid layout", () => {
  it("renders every item, in order, regardless of row completeness", () => {
    // 12 items: a full row plus a partial trailing row at common
    // breakpoints — the exact scenario from the reported bug.
    const items = makeItems(12);
    render(<MediaGrid items={items} />);

    const titles = screen.getAllByText(/^Title \d+$/).map((el) => el.textContent);
    expect(titles).toEqual(items.map((item) => `Title ${item.tmdb_id}`));
  });

  it("uses a fixed CSS Grid column count per breakpoint, not auto-fit/flex-grow, so every card is the same size regardless of how full the row is", () => {
    const items = makeItems(5);
    const { container } = render(<MediaGrid items={items} />);

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("grid");
    expect(wrapper.className).toMatch(/grid-cols-2\b/);
    expect(wrapper.className).toMatch(/min-\[1000px\]:grid-cols-4/);
    expect(wrapper.className).toMatch(/min-\[1280px\]:grid-cols-6/);
    expect(wrapper.className).not.toMatch(/auto-fit|auto-fill|flex-wrap/);
  });

  it("renders MediaCard as the direct grid child with min-w-0, so a long unbroken title can't force the card wider than its column", () => {
    const items = [
      {
        tmdb_id: 1,
        media_type: "movie" as const,
        title: "You Can See Everything",
        year: "2026",
        poster_path: "/poster-1.jpg",
        backdrop_path: null,
        rating: 0,
      },
    ];
    const { container } = render(<MediaGrid items={items} />);

    const gridChild = container.querySelector("a") as HTMLElement;
    expect(gridChild).toBeTruthy();
    expect(gridChild.className).toContain("min-w-0");
  });
});
