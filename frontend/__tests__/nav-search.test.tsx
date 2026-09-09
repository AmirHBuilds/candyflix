import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import NavSearch from "@/components/NavSearch";
import SearchPageClient from "@/components/SearchPageClient";

// Real component, real running backend (seeded with real confirmed
// TMDB data plus a couple of synthetic fixtures needed to exercise the
// 12-item cap — see backend/seed_test_cache.py). Only next/navigation
// is mocked, since it isn't available outside the Next.js runtime.

const pushMock = vi.fn();
const replaceMock = vi.fn();
const mockState = vi.hoisted(() => ({ params: new URLSearchParams() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
  useSearchParams: () => mockState.params,
}));

beforeEach(() => {
  pushMock.mockClear();
  replaceMock.mockClear();
  mockState.params = new URLSearchParams();
});

describe("NavSearch — large live-results overlay", () => {
  it("shows nothing before any typing", () => {
    render(<NavSearch />);
    expect(screen.queryByText(/searching/i)).not.toBeInTheDocument();
  });

  it("shows debounced live results without pressing Enter", async () => {
    const user = userEvent.setup();
    render(<NavSearch />);

    await user.type(
      screen.getByPlaceholderText("What do you want to watch?"),
      "Inception"
    );

    // No Enter pressed — results should appear on their own. (Two real
    // "Inception" entries exist in the seeded data.)
    expect((await screen.findAllByText("Inception")).length).toBeGreaterThan(0);
  });

  it("does NOT show 'See all results' when there are 12 or fewer matches", async () => {
    const user = userEvent.setup();
    render(<NavSearch />);

    await user.type(
      screen.getByPlaceholderText("What do you want to watch?"),
      "Inception"
    );
    await screen.findAllByText("Inception");

    expect(screen.queryByText(/see all results/i)).not.toBeInTheDocument();
  });

  it("caps live results at 12 and shows 'See all results' when there are more", async () => {
    const user = userEvent.setup();
    render(<NavSearch />);

    await user.type(
      screen.getByPlaceholderText("What do you want to watch?"),
      "manyresults"
    );

    await screen.findAllByText("Many Result Movie 1");

    // Count actual result cards by their unique hrefs, rather than by
    // text — fixtures with no poster_path legitimately render their
    // title twice (once as the poster placeholder, once as the caption).
    const links = screen
      .getAllByRole("link")
      .filter((el) => el.getAttribute("href")?.startsWith("/movie/9000"));
    expect(links).toHaveLength(12);

    expect(screen.getByText(/see all results for/i)).toBeInTheDocument();
  });

  it("links each result card to its own detail page", async () => {
    const user = userEvent.setup();
    render(<NavSearch />);

    await user.type(
      screen.getByPlaceholderText("What do you want to watch?"),
      "Inception"
    );

    // The 2010 Inception (tmdb_id 27205) is the top-ranked result.
    // MediaCard renders a real <Link>, which Next.js navigates
    // natively — not through the useRouter().push() we mock for our
    // own imperative calls — so we assert on the rendered href rather
    // than a router call.
    const cards = await screen.findAllByText("Inception");
    const link = cards[0].closest("a");
    expect(link).toHaveAttribute("href", "/movie/27205");
  });

  it("navigates to the full search page via 'See all results'", async () => {
    const user = userEvent.setup();
    render(<NavSearch />);

    await user.type(
      screen.getByPlaceholderText("What do you want to watch?"),
      "manyresults"
    );

    const seeAll = await screen.findByText(/see all results for/i);
    await user.click(seeAll);

    expect(pushMock).toHaveBeenCalledWith("/search?q=manyresults");
  });

  it("navigates to the full search page on Enter", async () => {
    const user = userEvent.setup();
    render(<NavSearch />);

    const input = screen.getByPlaceholderText("What do you want to watch?");
    await user.type(input, "Inception");
    await screen.findAllByText("Inception");

    await user.keyboard("{Enter}");

    expect(pushMock).toHaveBeenCalledWith("/search?q=Inception");
  });

  it("closes the panel on Escape", async () => {
    const user = userEvent.setup();
    render(<NavSearch />);

    const input = screen.getByPlaceholderText("What do you want to watch?");
    await user.type(input, "Inception");
    await screen.findAllByText("Inception");

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryAllByText("Inception")).toHaveLength(0)
    );
  });

  it("closes the panel when clicking outside", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <NavSearch />
        <button>outside</button>
      </div>
    );

    await user.type(
      screen.getByPlaceholderText("What do you want to watch?"),
      "Inception"
    );
    await screen.findAllByText("Inception");

    fireEvent.mouseDown(screen.getByText("outside"));

    await waitFor(() =>
      expect(screen.queryAllByText("Inception")).toHaveLength(0)
    );
  });

  it("shows a friendly empty state for a query with no matches", async () => {
    const user = userEvent.setup();
    render(<NavSearch />);

    await user.type(
      screen.getByPlaceholderText("What do you want to watch?"),
      "zzzznonexistentqueryzzzz"
    );

    expect(await screen.findByText(/no matches for/i)).toBeInTheDocument();
  });

  it("does not let a stale slow response overwrite newer results (race condition guard)", async () => {
    const user = userEvent.setup();
    render(<NavSearch />);

    const input = screen.getByPlaceholderText("What do you want to watch?");
    await user.type(input, "Ince");
    await user.type(input, "ption");

    const found = await screen.findAllByText("Inception");
    expect(found.length).toBeGreaterThan(0);
    expect(screen.queryByText(/unavailable/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no matches/i)).not.toBeInTheDocument();
  });
});

describe("SearchPageClient — URL-derived state", () => {
  it("reads the initial query from the URL and renders results", async () => {
    mockState.params = new URLSearchParams("q=Inception");
    render(<SearchPageClient />);

    expect(
      screen.getByPlaceholderText("What do you want to watch?")
    ).toHaveValue("Inception");
    expect((await screen.findAllByText("Inception")).length).toBeGreaterThan(0);
  });

  it("updates the URL (via replace) as the user types", async () => {
    const user = userEvent.setup();
    render(<SearchPageClient />);

    await user.type(
      screen.getByPlaceholderText("What do you want to watch?"),
      "Inception"
    );

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith("/search?q=Inception", {
        scroll: false,
      })
    );
  });
});
