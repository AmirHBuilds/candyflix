import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const push = vi.fn();
const refresh = vi.fn();
const mockPathname = { value: "/" };
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
  usePathname: () => mockPathname.value,
}));
vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return { ...actual, logout: vi.fn().mockResolvedValue(undefined) };
});

import UserMenu from "@/components/UserMenu";
import * as auth from "@/lib/auth";

const user = (over: Partial<auth.UserPublic> = {}): auth.UserPublic => ({
  id: "1",
  username: "candy",
  display_name: "Candy",
  created_at: "2026-01-01T00:00:00Z",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockPathname.value = "/";
});

const trigger = () => screen.getByRole("button", { name: /Candy/ });

describe("UserMenu", () => {
  it("shows the person's name and initial, with the menu closed", () => {
    render(<UserMenu user={user()} />);
    expect(trigger()).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("C")).toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens a menu with Settings and Log out, and focuses the first item", () => {
    render(<UserMenu user={user()} />);
    fireEvent.click(trigger());

    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    const items = screen.getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Settings", "Log out"]);
    expect(screen.getByRole("menuitem", { name: "Settings" })).toHaveAttribute("href", "/settings");
    expect(items[0]).toHaveFocus();
  });

  it("shows the @username, and an Admin badge only for admins", () => {
    const { unmount } = render(<UserMenu user={user()} />);
    fireEvent.click(trigger());
    expect(screen.getByText(/@candy/)).toBeInTheDocument();
    expect(screen.queryByText("Admin")).not.toBeInTheDocument();
    unmount();

    render(<UserMenu user={user({ is_admin: true })} />);
    fireEvent.click(trigger());
    expect(screen.getByText("Admin")).toBeInTheDocument();
  });

  it("Escape closes it and puts focus back on the button", () => {
    render(<UserMenu user={user()} />);
    fireEvent.click(trigger());
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it("an outside click closes it, an inside click doesn't", () => {
    render(
      <div>
        <p>elsewhere</p>
        <UserMenu user={user()} />
      </div>
    );
    fireEvent.click(trigger());
    fireEvent.mouseDown(screen.getByRole("menu"));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByText("elsewhere"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("the button toggles it closed again", () => {
    render(<UserMenu user={user()} />);
    fireEvent.click(trigger());
    fireEvent.click(trigger());
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("arrow keys, Home and End move between items (wrapping)", () => {
    render(<UserMenu user={user()} />);
    fireEvent.click(trigger());
    const [settings, logoutItem] = screen.getAllByRole("menuitem");
    const menu = screen.getByRole("menu");

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(logoutItem).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(settings).toHaveFocus(); // wrapped
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(logoutItem).toHaveFocus(); // wrapped backwards
    fireEvent.keyDown(menu, { key: "Home" });
    expect(settings).toHaveFocus();
    fireEvent.keyDown(menu, { key: "End" });
    expect(logoutItem).toHaveFocus();
  });

  it("closes when the route changes (e.g. after choosing Settings)", () => {
    const { rerender } = render(<UserMenu user={user()} />);
    fireEvent.click(trigger());
    mockPathname.value = "/settings";
    rerender(<UserMenu user={user()} />);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("Log out signs out and returns to the 'Who's watching?' screen", async () => {
    render(<UserMenu user={user()} />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitem", { name: "Log out" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
    expect(auth.logout).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalled();
  });

  it("shows an Admin panel link to admins only", () => {
    const { unmount } = render(<UserMenu user={user({ is_admin: true })} />);
    fireEvent.click(trigger());
    expect(screen.getByRole("menuitem", { name: "Admin panel" })).toHaveAttribute("href", "/admin");
    unmount();
    render(<UserMenu user={user({ is_admin: false })} />);
    fireEvent.click(trigger());
    expect(screen.queryByRole("menuitem", { name: "Admin panel" })).toBeNull();
  });
});
