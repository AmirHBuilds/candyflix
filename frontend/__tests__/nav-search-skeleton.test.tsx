import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

import NavSearch from "@/components/NavSearch";
import * as media from "@/lib/media";
import type { MediaItem } from "@/lib/media";

vi.mock("@/lib/media", async () => {
  const actual = await vi.importActual<typeof media>("@/lib/media");
  return { ...actual, searchMedia: vi.fn() };
});

const movie = (id: number, title: string): MediaItem => ({
  tmdb_id: id,
  media_type: "movie",
  title,
  year: "2026",
  poster_path: null,
  backdrop_path: null,
  rating: null,
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const type = (value: string) =>
  fireEvent.change(screen.getByPlaceholderText("What do you want to watch?"), { target: { value } });

beforeEach(() => vi.clearAllMocks());

describe("NavSearch dropdown — loading", () => {
  it("shows placeholder cards (not just a text line) while the first results load", async () => {
    const d = deferred<MediaItem[]>();
    vi.mocked(media.searchMedia).mockReturnValue(d.promise);
    render(<NavSearch />);

    type("matrix");

    expect(await screen.findByRole("status")).toHaveTextContent("Loading…");
    expect(screen.queryByText("Searching…")).not.toBeInTheDocument();

    d.resolve([movie(1, "The Matrix")]);
    expect((await screen.findAllByText("The Matrix")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("on the next keystroke it keeps the previous results and just says it's refreshing (no skeleton flash)", async () => {
    vi.mocked(media.searchMedia).mockResolvedValueOnce([movie(1, "The Matrix")]);
    render(<NavSearch />);
    type("matrix");
    // (A poster-less card shows its title twice: placeholder + caption.)
    expect((await screen.findAllByText("The Matrix")).length).toBeGreaterThan(0);

    const d = deferred<MediaItem[]>();
    vi.mocked(media.searchMedia).mockReturnValueOnce(d.promise);
    type("matrix r");

    expect(await screen.findByText("Searching…")).toBeInTheDocument();
    expect(screen.getAllByText("The Matrix").length).toBeGreaterThan(0);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    d.resolve([movie(2, "The Matrix Reloaded")]);
    expect((await screen.findAllByText("The Matrix Reloaded")).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.queryByText("Searching…")).not.toBeInTheDocument());
  });

  it("an empty result is still the friendly 'No matches' message once loading is done", async () => {
    vi.mocked(media.searchMedia).mockResolvedValue([]);
    render(<NavSearch />);
    type("zzzz");
    expect(await screen.findByText(/No matches for/)).toBeInTheDocument();
  });
});

describe("NavSearch input — phone keyboards", () => {
  it("labels the return key 'Search' and turns off auto-capitalise / auto-correct / spellcheck for titles", () => {
    render(<NavSearch />);
    const input = screen.getByPlaceholderText("What do you want to watch?");
    expect(input).toHaveAttribute("enterkeyhint", "search");
    expect(input).toHaveAttribute("autocapitalize", "off");
    expect(input).toHaveAttribute("autocorrect", "off");
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveAttribute("spellcheck", "false");
  });
});
