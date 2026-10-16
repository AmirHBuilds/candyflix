import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

vi.mock("@/lib/admin", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin")>("@/lib/admin");
  return { ...actual, getUserDetail: vi.fn(), getUserHistory: vi.fn(), getPersonDevices: vi.fn(), endPersonDevice: vi.fn() };
});
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/lib/toast", () => ({ showToast: toast }));

import UserDetailView from "@/components/admin/UserDetailView";
import * as admin from "@/lib/admin";

const bob = { id: "bob", username: "bob", display_name: "Bob", is_admin: false, is_disabled: false, created_at: "2026-01-01T00:00:00Z", last_login_at: null, avatar_url: null, watchlist_count: 0, watched_count: 0 } as admin.AdminUser;
const dev = (over = {}) => ({
  id: "d1", label: "Safari on iOS", user_agent: "x", ip: "5.5.5.5", country: "IR", first_seen: "2026-10-01T10:00:00Z", last_seen: new Date(Date.now() - 3600_000).toISOString(),
  last_login_at: "2026-10-15T10:00:00Z", sign_ins: 7, active: true, sessions: 1, current: false, ...over,
});
const overview = (items = [dev(), dev({ id: "d2", label: "Chrome on Windows", ip: "6.6.6.6", country: "DE", active: false })]) => ({ items, active: 1, today: 2, limits_on: true, max_per_day: 3, max_active: 5 });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(admin.getUserDetail).mockResolvedValue({ user: bob, now_watching: null, active_sessions: 1, last_activity: null });
  vi.mocked(admin.getUserHistory).mockResolvedValue({ items: [], total: 0 });
  vi.mocked(admin.getPersonDevices).mockResolvedValue(overview());
});
afterEach(cleanup);

async function openDevices() {
  render(<UserDetailView userId="bob" onBack={() => {}} />);
  fireEvent.click(await screen.findByRole("tab", { name: "Devices" }));
}

describe("A person's devices (admin)", () => {
  it("lists each device with its address, country, last seen and state", async () => {
    await openDevices();
    expect(await screen.findByText("Safari on iOS")).toBeInTheDocument();
    expect(screen.getByText("5.5.5.5")).toBeInTheDocument();
    expect(screen.getByText(/Iran/)).toBeInTheDocument();
    expect(screen.getByText(/Germany/)).toBeInTheDocument();
    expect(screen.getByText("Signed in")).toBeInTheDocument();
    expect(screen.getByText("Signed out")).toBeInTheDocument();
    expect(screen.getAllByText(/7 sign-ins/).length).toBe(2);
    expect(screen.getByText(/Signed in on 1 of 5 allowed devices · 2 of 3 different devices today/)).toBeInTheDocument();
  });

  it("signs a device out and reloads the list", async () => {
    vi.mocked(admin.endPersonDevice).mockResolvedValue({ ended: 1 });
    await openDevices();
    fireEvent.click(await screen.findByRole("button", { name: "Sign out Safari on iOS" }));
    await waitFor(() => expect(admin.endPersonDevice).toHaveBeenCalledWith("bob", "d1"));
    await waitFor(() => expect(admin.getPersonDevices).toHaveBeenCalledTimes(2));
    expect(toast).toHaveBeenCalledWith("Safari on iOS was signed out.", "success");
    expect(screen.queryByRole("button", { name: "Sign out Chrome on Windows" })).not.toBeInTheDocument(); // already signed out
  });

  it("says so when there are none yet", async () => {
    vi.mocked(admin.getPersonDevices).mockResolvedValue(overview([]));
    await openDevices();
    expect(await screen.findByText(/No devices yet/)).toBeInTheDocument();
  });

  it("shows why it could not load", async () => {
    vi.mocked(admin.getPersonDevices).mockRejectedValue(new Error("Couldn't load their devices."));
    await openDevices();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load their devices.");
  });
});
