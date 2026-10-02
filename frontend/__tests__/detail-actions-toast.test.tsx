import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import DetailActions from "@/components/DetailActions";
import Toaster from "@/components/Toaster";
import * as watchlist from "@/lib/watchlist";
import { clearAllToasts } from "@/lib/toast";

vi.mock("@/lib/watchlist", async () => {
  const actual = await vi.importActual<typeof watchlist>("@/lib/watchlist");
  return {
    ...actual,
    getWatchlistStatus: vi.fn(),
    addToWatchlist: vi.fn(),
    removeFromWatchlist: vi.fn(),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  clearAllToasts();
});
afterEach(() => clearAllToasts());

function renderWithToaster() {
  return render(
    <>
      <DetailActions tmdbId={603} mediaType="movie" />
      <Toaster />
    </>
  );
}

describe("DetailActions — failed Candy Box toggles tell the person", () => {
  it("a failed add shows an error toast and leaves the button as it was", async () => {
    vi.mocked(watchlist.getWatchlistStatus).mockResolvedValue(false);
    vi.mocked(watchlist.addToWatchlist).mockRejectedValue(new Error("nope"));
    renderWithToaster();

    const button = await screen.findByRole("button", { name: "Add to Candy Box" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't add it to your Candy Box. Please try again.");
    expect(screen.getByRole("button", { name: "Add to Candy Box" })).toBeEnabled();
  });

  it("a failed remove says so too", async () => {
    vi.mocked(watchlist.getWatchlistStatus).mockResolvedValue(true);
    vi.mocked(watchlist.removeFromWatchlist).mockRejectedValue(new Error("nope"));
    renderWithToaster();

    const button = await screen.findByRole("button", { name: /In Candy Box/ });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't remove it from your Candy Box. Please try again.");
    expect(screen.getByRole("button", { name: /In Candy Box/ })).toBeInTheDocument();
  });

  it("a successful toggle shows no toast", async () => {
    vi.mocked(watchlist.getWatchlistStatus).mockResolvedValue(false);
    vi.mocked(watchlist.addToWatchlist).mockResolvedValue(undefined as never);
    renderWithToaster();

    const button = await screen.findByRole("button", { name: "Add to Candy Box" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    expect(await screen.findByRole("button", { name: /In Candy Box/ })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
