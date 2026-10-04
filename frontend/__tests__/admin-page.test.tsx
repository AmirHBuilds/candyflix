import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";

const redirect = vi.fn((to: string) => {
  throw new Error(`redirect:${to}`);
});
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));
vi.mock("@/lib/session", () => ({ getServerCurrentUser: vi.fn() }));
vi.mock("@/components/admin/AdminPanel", () => ({ default: () => <div>PANEL</div> }));

import AdminPage from "@/app/(main)/admin/page";
import { getServerCurrentUser } from "@/lib/session";

const user = { id: "1", username: "a", display_name: "A", created_at: "x" };

beforeEach(() => vi.clearAllMocks());

describe("/admin page", () => {
  it("sends signed-out visitors to the login screen", async () => {
    vi.mocked(getServerCurrentUser).mockResolvedValue(null);
    await expect(AdminPage()).rejects.toThrow("redirect:/login");
  });

  it("shows regular users a clear 'admins only' page, not the panel", async () => {
    vi.mocked(getServerCurrentUser).mockResolvedValue({ ...user, is_admin: false });
    render(await AdminPage());
    expect(screen.getByRole("heading", { name: "Admins only" })).toBeInTheDocument();
    expect(screen.queryByText("PANEL")).toBeNull();
  });

  it("shows admins the panel", async () => {
    vi.mocked(getServerCurrentUser).mockResolvedValue({ ...user, is_admin: true });
    render(await AdminPage());
    expect(screen.getByText("PANEL")).toBeInTheDocument();
  });
});
