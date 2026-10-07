import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RatingsButton from "@/components/RatingsButton";
import TrailerButton from "@/components/TrailerButton";

vi.mock("@/lib/rating-sources", async (orig) => {
  const real = await orig<typeof import("@/lib/rating-sources")>();
  return { ...real, getRatings: vi.fn() };
});
import { getRatings } from "@/lib/rating-sources";

const EXTERNAL = [
  { source: "imdb" as const, label: "IMDb", display: "8.7", suffix: "/10", value: 8.7, votes: 2100345, url: "https://www.imdb.com/title/tt1/" },
  { source: "rotten_tomatoes" as const, label: "Rotten Tomatoes", display: "83%", suffix: "", value: 83, votes: null, url: null },
];
const show = (rating: number | null = 7.8) => render(<RatingsButton mediaType="movie" tmdbId={603} tmdbRating={rating} />);

beforeEach(() => vi.mocked(getRatings).mockReset().mockResolvedValue({ ratings: EXTERNAL, configured: true }));
afterEach(cleanup);

describe("RatingsButton", () => {
  it("shows ★ score and asks the server nothing until it is clicked", () => {
    show();
    expect(screen.getByRole("button", { name: "Show all ratings" })).toHaveTextContent("7.8");
    expect(getRatings).not.toHaveBeenCalled();
  });

  it("on click opens a window with every rating, fetching once even when reopened", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Show all ratings" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("IMDb 8.7/10")).toBeInTheDocument());
    expect(screen.getByLabelText("Rotten Tomatoes 83%")).toBeInTheDocument();
    expect(screen.getByLabelText("TMDB 7.8/10")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Show all ratings" }));
    await waitFor(() => expect(screen.getByLabelText("IMDb 8.7/10")).toBeInTheDocument());
    expect(getRatings).toHaveBeenCalledTimes(1);
  });

  it("says so when the server has no OMDb key", async () => {
    vi.mocked(getRatings).mockResolvedValue({ ratings: [], configured: false });
    show();
    fireEvent.click(screen.getByRole("button", { name: "Show all ratings" }));
    expect(await screen.findByText(/aren.t set up on this server/)).toBeInTheDocument();
    expect(screen.getByLabelText("TMDB 7.8/10")).toBeInTheDocument();
  });

  it("tries again on the next open if the request failed", async () => {
    vi.mocked(getRatings).mockRejectedValueOnce(new Error("x"));
    show();
    fireEvent.click(screen.getByRole("button", { name: "Show all ratings" }));
    expect(await screen.findByText(/Couldn.t load the other ratings/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Show all ratings" }));
    await waitFor(() => expect(screen.getByLabelText("IMDb 8.7/10")).toBeInTheDocument());
  });
});

describe("TrailerButton", () => {
  it("opens the YouTube trailer on click and closes again", () => {
    render(<TrailerButton youtubeKey="abc123" title="The Matrix" />);
    expect(screen.queryByTitle("The Matrix trailer")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /watch trailer/i }));
    expect(screen.getByTitle("The Matrix trailer").getAttribute("src")).toContain("youtube-nocookie.com/embed/abc123");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByTitle("The Matrix trailer")).toBeNull();
  });
});
