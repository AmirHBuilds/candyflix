import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockPathname = vi.hoisted(() => ({ value: "/" }));
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname.value,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return { ...actual, getCurrentUser: vi.fn(), logout: vi.fn() };
});

import Nav from "@/components/Nav";
import * as auth from "@/lib/auth";

const candy = { id: "1", username: "candy", display_name: "Candy", created_at: "x" };

beforeEach(() => {
  vi.clearAllMocks();
  mockPathname.value = "/";
  vi.mocked(auth.getCurrentUser).mockResolvedValue(candy);
});

describe("Nav — the person's name is now a menu", () => {
  it("shows the name as a menu button (not a name plus a separate Log out button)", async () => {
    render(<Nav />);
    const button = await screen.findByRole("button", { name: /Candy/ });
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    // The old inline "Log out" is only reachable through the menus now.
    expect(screen.queryByRole("button", { name: "Log out" })).not.toBeInTheDocument();
  });

  it("the desktop menu offers Settings and Log out", async () => {
    render(<Nav />);
    fireEvent.click(await screen.findByRole("button", { name: /Candy/ }));
    expect(screen.getByRole("menuitem", { name: "Settings" })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("menuitem", { name: "Log out" })).toBeInTheDocument();
  });

  it("the phone menu lists the name, Settings and Log out", async () => {
    render(<Nav />);
    await screen.findByRole("button", { name: /Candy/ });
    fireEvent.click(screen.getByRole("button", { name: /menu/i }));

    await waitFor(() => expect(screen.getAllByRole("link", { name: "Settings" }).length).toBeGreaterThan(0));
    const settingsLinks = screen.getAllByRole("link", { name: "Settings" });
    expect(settingsLinks.some((a) => a.getAttribute("href") === "/settings")).toBe(true);
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
  });

  it("shows nothing user-related while signed out", async () => {
    vi.mocked(auth.getCurrentUser).mockResolvedValue(null);
    render(<Nav />);
    await waitFor(() => expect(auth.getCurrentUser).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /Candy/ })).not.toBeInTheDocument();
  });
});
