import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";

import DetailActions from "@/components/DetailActions";
import * as watchlist from "@/lib/watchlist";
import * as lib from "@/lib/opinions";

vi.mock("@/lib/watchlist", async () => {
  const actual = await vi.importActual<typeof watchlist>("@/lib/watchlist");
  return { ...actual, getWatchlistStatus: vi.fn().mockResolvedValue(false), addToWatchlist: vi.fn(), removeFromWatchlist: vi.fn() };
});
vi.mock("@/lib/opinions", async () => {
  const actual = await vi.importActual<typeof lib>("@/lib/opinions");
  return { ...actual, getTitleOpinions: vi.fn(), likeTitle: vi.fn() };
});

const data = (): lib.TitleOpinions => ({
  enabled: true, moderator: false, can_comment: true, why_not: null, allow_anonymous: true, allow_replies: true, anonymous_default: false,
  likes: { count: 3, you_liked: false, people: [{ id: "c", name: "Candy", avatar_url: null }], more: 2 }, comment_count: 9, opinions: [],
});

beforeEach(() => vi.clearAllMocks());

describe("DetailActions — heart and discussion", () => {
  it("a detail page gets the heart, the discussion icon with its count, and the liked-by line", async () => {
    vi.mocked(lib.getTitleOpinions).mockResolvedValue(data());
    render(<DetailActions tmdbId={901} mediaType="movie" title="Spirited Away" />);
    expect(await screen.findByRole("button", { name: "Like" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discussion, 9 comments" })).toBeInTheDocument();
    expect(screen.getByText("Candy + 2 others liked this")).toBeInTheDocument();
    // one joined block: the heart and the discussion icon share a parent
    expect(screen.getByRole("button", { name: "Like" }).parentElement).toBe(screen.getByRole("button", { name: "Discussion, 9 comments" }).parentElement);
  });

  it("the home banner's buttons stay Watch Now and Add to box: no heart, no request", async () => {
    vi.mocked(lib.getTitleOpinions).mockResolvedValue(data());
    render(<DetailActions tmdbId={902} mediaType="movie" />);
    await screen.findByRole("link", { name: /Watch Now/ });
    await waitFor(() => expect(watchlist.getWatchlistStatus).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Like" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Discussion/ })).toBeNull();
    expect(lib.getTitleOpinions).not.toHaveBeenCalled();
  });
});
