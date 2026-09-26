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

describe("Nav — everywhere except the player", () => {
  it("shows the full-width search row and no search icon", () => {
    mockPathname.value = "/";
    render(<Nav />);
    expect(screen.getByPlaceholderText("What do you want to watch?")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Search" })).not.toBeInTheDocument();
  });
});

describe("Nav — on a player page", () => {
  it("shows a search icon instead of the full-width row", () => {
    mockPathname.value = "/watch/movie/603";
    render(<Nav />);
    expect(screen.queryByPlaceholderText("What do you want to watch?")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
  });

  it("expands into the search input when the icon is clicked", async () => {
    mockPathname.value = "/watch/tv/1396/1/1";
    render(<Nav />);

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByPlaceholderText("What do you want to watch?")).toBeInTheDocument();
  });

  it("collapses back to the icon on an outside click", async () => {
    mockPathname.value = "/watch/tv/1396/1/1";
    render(<Nav />);

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByPlaceholderText("What do you want to watch?");

    fireEvent.mouseDown(document.body);

    await waitFor(() =>
      expect(screen.queryByPlaceholderText("What do you want to watch?")).not.toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
  });

  it("collapses back to the icon via its own close button", async () => {
    mockPathname.value = "/watch/movie/603";
    render(<Nav />);

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByPlaceholderText("What do you want to watch?");

    fireEvent.click(screen.getByRole("button", { name: "Close search" }));
    expect(screen.queryByPlaceholderText("What do you want to watch?")).not.toBeInTheDocument();
  });
});
