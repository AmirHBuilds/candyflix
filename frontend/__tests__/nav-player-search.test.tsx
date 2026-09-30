import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import Nav from "@/components/Nav";
import * as auth from "@/lib/auth";

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof auth>("@/lib/auth");
  return { ...actual, getCurrentUser: vi.fn().mockResolvedValue(null) };
});

const mockPathname = vi.hoisted(() => ({ value: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname.value,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const PLACEHOLDER = "What do you want to watch?";

describe("Nav — everywhere except the player", () => {
  it("shows the full-width search row and no search icon", () => {
    mockPathname.value = "/";
    render(<Nav />);
    expect(screen.getByPlaceholderText(PLACEHOLDER)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Search" })).not.toBeInTheDocument();
  });

  it("does not steal focus on page load", () => {
    mockPathname.value = "/";
    render(<Nav />);
    expect(screen.getByPlaceholderText(PLACEHOLDER)).not.toHaveFocus();
  });
});

describe("Nav — search row on small screens (edge to edge below sm)", () => {
  it("has no side padding below sm, and keeps sm:px-10 from 640px up", () => {
    mockPathname.value = "/";
    render(<Nav />);
    const row = screen.getByPlaceholderText(PLACEHOLDER).closest("div.border-t")!;
    expect(row).toHaveClass("px-0", "sm:px-10");
    expect(row).not.toHaveClass("px-6");
  });

  it("squares the input's side edges below sm so it sits flush against the screen", () => {
    mockPathname.value = "/";
    render(<Nav />);
    expect(screen.getByPlaceholderText(PLACEHOLDER)).toHaveClass("max-sm:rounded-none", "max-sm:border-x-0");
  });
});

describe("Nav — on a player page", () => {
  it("shows only a search icon; the search box is hidden", () => {
    mockPathname.value = "/watch/movie/603";
    render(<Nav />);
    expect(screen.queryByPlaceholderText(PLACEHOLDER)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
  });

  it("reveals the standard full-width search row (same placeholder, same row styling) and focuses it", async () => {
    mockPathname.value = "/watch/tv/1396/1/1";
    render(<Nav />);

    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    const input = await screen.findByPlaceholderText(PLACEHOLDER);
    // Same row as every other page — not a small inline box.
    const row = input.closest("div.border-t")!;
    expect(row).toHaveClass("px-0", "sm:px-10", "py-3");
    expect(input.closest("div.w-48")).toBeNull();
    expect(input).toHaveFocus();
  });

  it("turns the icon into a cancel button while open, and cancel hides the box again", async () => {
    mockPathname.value = "/watch/movie/603";
    render(<Nav />);

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByPlaceholderText(PLACEHOLDER);
    // Icon became the cancel button: same slot, no second button.
    expect(screen.queryByRole("button", { name: "Search" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close search" }));
    expect(screen.queryByPlaceholderText(PLACEHOLDER)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
  });

  it("does NOT collapse on an outside click (it would fight the results dropdown)", async () => {
    mockPathname.value = "/watch/tv/1396/1/1";
    render(<Nav />);

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByPlaceholderText(PLACEHOLDER);

    fireEvent.mouseDown(document.body);

    expect(screen.getByPlaceholderText(PLACEHOLDER)).toBeInTheDocument();
  });

  it("closes the box when the route changes (e.g. after picking a result)", async () => {
    mockPathname.value = "/watch/movie/603";
    const { rerender } = render(<Nav />);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByPlaceholderText(PLACEHOLDER);

    mockPathname.value = "/watch/movie/604";
    rerender(<Nav />);

    // Still a player page, so the box is hidden again behind the icon.
    await waitFor(() => expect(screen.queryByPlaceholderText(PLACEHOLDER)).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
  });
});
