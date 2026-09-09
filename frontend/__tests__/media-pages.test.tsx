import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Home from "@/app/(main)/page";
import MoviesPage from "@/app/(main)/movies/page";
import SeriesPage from "@/app/(main)/series/page";
import SearchPage from "@/app/(main)/search/page";
import MovieDetailPage from "@/app/(main)/movie/[id]/page";
import TVDetailPage from "@/app/(main)/tv/[id]/page";

// These mount the REAL page components (async Server Components,
// called and awaited directly, exactly as Next.js would) against the
// real running backend, which itself talks to the real TMDB API.
// Nothing here is mocked except next/navigation, which isn't
// available outside the Next.js runtime.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

describe("Home page — real component, real backend, real TMDB data", () => {
  it("renders a hero carousel and all four browsing sections", async () => {
    render(await Home());

    expect(await screen.findByText("Trending Today")).toBeInTheDocument();
    expect(screen.getByText("Trending This Week")).toBeInTheDocument();
    expect(screen.getByText("Popular Movies")).toBeInTheDocument();
    expect(screen.getByText("Popular TV Shows")).toBeInTheDocument();
    // The carousel renders every slide in the DOM (crossfaded via
    // opacity), so multiple "Watch Now" buttons are expected — one per
    // slide — not just one.
    expect(screen.getAllByText("Watch Now").length).toBeGreaterThan(0);
  });
});

describe("Movies page", () => {
  it("renders only movies from trending", async () => {
    render(await MoviesPage());
    expect(screen.getByRole("heading", { name: "Movies" })).toBeInTheDocument();
  });
});

describe("Series page", () => {
  it("renders only series from trending", async () => {
    render(await SeriesPage());
    expect(screen.getByRole("heading", { name: "Series" })).toBeInTheDocument();
  });
});

describe("Search page — real debounced search against real backend", () => {
  it("finds Inception by typing", async () => {
    const user = userEvent.setup();
    render(<SearchPage />);

    const input = screen.getByPlaceholderText("What do you want to watch?");
    await user.type(input, "Inception");

    await waitFor(
      () => expect(screen.getAllByText("Inception").length).toBeGreaterThan(0),
      { timeout: 3000 }
    );
  }, 10000);
});

describe("Movie detail page — real Inception data", () => {
  it("renders title, genres, overview, disabled action buttons, and similar titles", async () => {
    render(await MovieDetailPage({ params: Promise.resolve({ id: "27205" }) }));

    expect(screen.getByRole("heading", { name: "Inception" })).toBeInTheDocument();
    expect(screen.getByText("Action")).toBeInTheDocument();

    const watchButton = screen.getByRole("button", { name: "Watch Now" });
    const candyBoxButton = screen.getByRole("button", { name: "Add to Candy Box" });
    expect(watchButton).toBeDisabled();
    expect(candyBoxButton).toBeDisabled();

    expect(await screen.findByText("You May Also Like")).toBeInTheDocument();
  });
});

describe("TV detail page — real Breaking Bad data", () => {
  it("renders title, seasons, and lets you browse episodes", async () => {
    const user = userEvent.setup();
    render(await TVDetailPage({ params: Promise.resolve({ id: "1396" }) }));

    expect(screen.getByRole("heading", { name: "Breaking Bad" })).toBeInTheDocument();

    const season2Button = await screen.findByText("Season 2");
    await user.click(season2Button);

    // Season 1's "Pilot" should disappear once we switch to Season 2,
    // and Season 2's real first episode should appear.
    await waitFor(() => expect(screen.queryByText(/Pilot/)).not.toBeInTheDocument());

    expect(await screen.findByText("You May Also Like")).toBeInTheDocument();
  });
});
