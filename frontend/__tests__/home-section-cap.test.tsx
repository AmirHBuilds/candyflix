import { describe, it, expect } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";

import { Section } from "@/app/(main)/page";
import type { MediaItem } from "@/lib/media";

// Section takes items as a plain prop, so this test needs no backend
// or TMDB access.

function makeItems(count: number): MediaItem[] {
  return Array.from({ length: count }, (_, i) => ({
    tmdb_id: i + 1,
    media_type: "movie" as const,
    title: `Title ${i + 1}`,
    year: "2026",
    poster_path: `/poster-${i + 1}.jpg`,
    backdrop_path: null,
    rating: 7.5,
  }));
}

describe("Home Section item cap", () => {
  it("caps a curated section at 24 items — a common multiple of the 4-col and 6-col grid — so rows always end complete", () => {
    const items = makeItems(30);
    render(<Section title="Trending Today" items={items} error={null} />);

    const titles = screen.getAllByText(/^Title \d+$/);
    expect(titles).toHaveLength(24);
    // Keeps the highest-ranked items (TMDB order), not an arbitrary slice.
    expect(titles[0].textContent).toBe("Title 1");
    expect(titles[23].textContent).toBe("Title 24");
  });

  it("renders all items unchanged when there are fewer than 24", () => {
    const items = makeItems(10);
    render(<Section title="Trending Today" items={items} error={null} />);

    const titles = screen.getAllByText(/^Title \d+$/);
    expect(titles).toHaveLength(10);
  });
});
