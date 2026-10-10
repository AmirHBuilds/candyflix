import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("@/lib/admin", () => ({
  listAdminUsers: vi.fn(),
  createAdminUser: vi.fn(),
  updateAdminUser: vi.fn(),
  resetAdminPassword: vi.fn(),
  deleteAdminUser: vi.fn(),
  getAdminStats: vi.fn(),
  getNowWatching: vi.fn().mockResolvedValue([]),
  getUserDetail: vi.fn(),
  switchOffTwoFactor: vi.fn(),
  getUserHistory: vi.fn(),
  getUserWatchlist: vi.fn(),
  getSystemStatus: vi.fn(),
  clearTmdbCache: vi.fn(),
  clearSubtitleCache: vi.fn(),
}));
vi.mock("@/lib/toast", () => ({ showToast: vi.fn() }));

import AdminPanel from "@/components/admin/AdminPanel";
import * as admin from "@/lib/admin";
import { showToast } from "@/lib/toast";

// Row actions live in a "⋯" menu: open the person's menu (if it isn't open) and return the item.
function menuItem(label: string): HTMLElement {
  const item = screen.queryByRole("menuitem", { name: label });
  if (item) return item;
  const person = label.split(" ").pop()!;
  fireEvent.click(screen.getByRole("button", { name: `Actions for ${person}` }));
  return screen.getByRole("menuitem", { name: label });
}

const u = (over: Partial<admin.AdminUser>): admin.AdminUser => ({
  id: "u1",
  username: "bob",
  display_name: "Bob",
  is_admin: false,
  is_disabled: false,
  created_at: "2026-01-01T00:00:00Z",
  last_login_at: null,
  avatar_url: null,
  watchlist_count: 2,
  watched_count: 3,
  ai_daily_limit: null,
  watch_ai_daily_limit: null,
  two_factor_enabled: false,
  ai_use_history: true,
  ...over,
});
const me = u({ id: "me", username: "root", display_name: "Root", is_admin: true });
const bob = u({});

const stats: admin.AdminStats = {
  users_total: 2,
  admins: 1,
  disabled: 0,
  active_last_7_days: 1,
  watchlist_items: 4,
  watched_items: 6,
  activity: Array.from({ length: 14 }, (_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, saves: i, active_users: 1 })),
  top_titles: [{ tmdb_id: 1, media_type: "movie", title: "Big Movie", viewers: 2 }],
  recent_logins: [{ id: "me", username: "root", display_name: "Root", avatar_url: null, last_login_at: "2026-01-02T10:00:00Z" }],
};

const ok = (detail = "fine", latency_ms: number | null = 3) => ({ ok: true, detail, latency_ms });
const system: admin.SystemStatus = {
  database: ok(),
  redis: ok(),
  tmdb: { ok: false, detail: "TMDB_API_KEY is not set", latency_ms: null },
  opensubtitles: ok("API key configured", null),
  omdb: ok("API key configured", null),
  gemini: ok("API key configured", null),
  subtitle_cache: { files: 2, bytes: 2048 },
  avatars: { files: 1, bytes: 500 },
  app_version: "0.9.0",
  python_version: "3.12.1",
  auto_migrate: true,
  debug: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(admin.listAdminUsers).mockResolvedValue([me, bob]);
  vi.mocked(admin.getAdminStats).mockResolvedValue(stats);
  vi.mocked(admin.getNowWatching).mockResolvedValue([]);
  vi.mocked(admin.getSystemStatus).mockResolvedValue(system);
});

const openTab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));

describe("Admin panel", () => {
  it("starts on the overview and switches tabs", async () => {
    render(<AdminPanel currentUserId="me" />);
    expect(await screen.findByText("Big Movie")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    openTab("Users");
    expect(await screen.findByText("Bob")).toBeInTheDocument();
    expect(screen.queryByText("Big Movie")).toBeNull();
  });

  it("Update fetches fresh numbers without reloading the page", async () => {
    render(<AdminPanel currentUserId="me" />);
    await screen.findByText("Big Movie");
    const before = vi.mocked(admin.getAdminStats).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    await waitFor(() => expect(vi.mocked(admin.getAdminStats).mock.calls.length).toBeGreaterThan(before));
    expect(await screen.findByText("Big Movie")).toBeInTheDocument();
  });

  it("shows an error when the dashboard can't load", async () => {
    vi.mocked(admin.getAdminStats).mockRejectedValue(new Error("boom"));
    render(<AdminPanel currentUserId="me" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
  });

  describe("users", () => {
    const openUsers = async () => {
      render(<AdminPanel currentUserId="me" />);
      openTab("Users");
      await screen.findByText("Bob");
    };

    it("marks you and admins, and offers no self-destructive actions on your own row", async () => {
      await openUsers();
      expect(screen.getByText("You")).toBeInTheDocument();
      expect(menuItem("Edit Root")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Delete Root" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Disable Root" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Reset password for Root" })).toBeNull();
      expect(menuItem("Delete Bob")).toBeInTheDocument();
    });

    it("adds a user once the form is valid", async () => {
      vi.mocked(admin.createAdminUser).mockResolvedValue(u({ id: "n", username: "new", display_name: "New" }));
      await openUsers();
      fireEvent.click(screen.getByRole("button", { name: "Add user" }));
      const dialog = screen.getByRole("dialog");
      const submit = within(dialog).getByRole("button", { name: "Add user" });
      expect(submit).toBeDisabled();
      fireEvent.change(within(dialog).getByLabelText(/^Username/), { target: { value: "new" } });
      fireEvent.change(within(dialog).getByLabelText("Display name"), { target: { value: "New" } });
      fireEvent.change(within(dialog).getByLabelText(/^Password/), { target: { value: "password123" } });
      expect(within(dialog).queryByRole("checkbox")).toBeNull(); // admin is not a checkbox any more
      fireEvent.click(submit);
      await waitFor(() =>
        expect(admin.createAdminUser).toHaveBeenCalledWith({ username: "new", display_name: "New", password: "password123", is_admin: false })
      );
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(showToast).toHaveBeenCalledWith("New was added.", "success");
    });

    it("making someone an admin needs a typed confirmation", async () => {
      vi.mocked(admin.createAdminUser).mockResolvedValue(u({ id: "n", username: "new", display_name: "New", is_admin: true }));
      await openUsers();
      fireEvent.click(screen.getByRole("button", { name: "Add user" }));
      const dialog = screen.getByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText(/^Username/), { target: { value: "new" } });
      fireEvent.change(within(dialog).getByLabelText("Display name"), { target: { value: "New" } });
      fireEvent.change(within(dialog).getByLabelText(/^Password/), { target: { value: "password123" } });
      fireEvent.click(within(dialog).getByRole("button", { name: /Create as an admin instead/ }));
      // can't be submitted while the question is open, and "yes" stays off until the word is typed
      expect(within(dialog).getByRole("button", { name: "Add user" })).toBeDisabled();
      const yes = within(dialog).getByRole("button", { name: "Yes, make them an admin" });
      expect(yes).toBeDisabled();
      fireEvent.change(within(dialog).getByLabelText("Type admin to confirm"), { target: { value: "admin" } });
      fireEvent.click(yes);
      fireEvent.click(within(dialog).getByRole("button", { name: "Add admin" }));
      await waitFor(() =>
        expect(admin.createAdminUser).toHaveBeenCalledWith({ username: "new", display_name: "New", password: "password123", is_admin: true })
      );
      expect(showToast).toHaveBeenCalledWith("New was added as an admin.", "success");
    });

    it("backing out of the admin question goes back to a normal user", async () => {
      await openUsers();
      fireEvent.click(screen.getByRole("button", { name: "Add user" }));
      const dialog = screen.getByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: /Create as an admin instead/ }));
      fireEvent.click(within(within(dialog).getByRole("group", { name: "Confirm admin" })).getByRole("button", { name: "Cancel" }));
      expect(within(dialog).queryByLabelText("Type admin to confirm")).toBeNull();
    });

    it("shows who has two-step sign-in and lets an admin switch it off", async () => {
      vi.mocked(admin.listAdminUsers).mockResolvedValue([me, u({ two_factor_enabled: true })]);
      vi.mocked(admin.switchOffTwoFactor).mockResolvedValue(u({ two_factor_enabled: false }));
      await openUsers();
      expect(screen.getByText("2-step")).toBeInTheDocument();
      fireEvent.click(menuItem("Switch off two-step sign-in for Bob"));
      await waitFor(() => expect(admin.switchOffTwoFactor).toHaveBeenCalledWith("u1"));
    });

    it("keeps the dialog open and shows the server's reason on failure", async () => {
      vi.mocked(admin.createAdminUser).mockRejectedValue(new Error("The username 'new' is already taken."));
      await openUsers();
      fireEvent.click(screen.getByRole("button", { name: "Add user" }));
      const dialog = screen.getByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText(/^Username/), { target: { value: "new" } });
      fireEvent.change(within(dialog).getByLabelText("Display name"), { target: { value: "New" } });
      fireEvent.change(within(dialog).getByLabelText(/^Password/), { target: { value: "password123" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Add user" }));
      expect(await within(dialog).findByRole("alert")).toHaveTextContent("already taken");
      expect(within(dialog).getByRole("button", { name: "Add user" })).toBeEnabled();
    });

    it("edits only what changed", async () => {
      vi.mocked(admin.updateAdminUser).mockResolvedValue(bob);
      await openUsers();
      fireEvent.click(menuItem("Edit Bob"));
      const dialog = screen.getByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText("Display name"), { target: { value: "Robert" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
      await waitFor(() => expect(admin.updateAdminUser).toHaveBeenCalledWith("u1", { display_name: "Robert" }));
    });

    it("saving with no changes just closes", async () => {
      await openUsers();
      fireEvent.click(menuItem("Edit Bob"));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(admin.updateAdminUser).not.toHaveBeenCalled();
    });

    it("promotes to admin from the edit dialog", async () => {
      vi.mocked(admin.updateAdminUser).mockResolvedValue(bob);
      await openUsers();
      fireEvent.click(menuItem("Edit Bob"));
      const dialog = screen.getByRole("dialog");
      fireEvent.click(within(dialog).getByLabelText(/^Admin/));
      fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
      await waitFor(() => expect(admin.updateAdminUser).toHaveBeenCalledWith("u1", { is_admin: true }));
    });

    it("disables and re-enables with one click", async () => {
      vi.mocked(admin.updateAdminUser).mockResolvedValue(bob);
      await openUsers();
      fireEvent.click(menuItem("Disable Bob"));
      await waitFor(() => expect(admin.updateAdminUser).toHaveBeenCalledWith("u1", { is_disabled: true }));
    });

    it("offers Enable for a disabled person", async () => {
      vi.mocked(admin.listAdminUsers).mockResolvedValue([me, u({ is_disabled: true })]);
      await openUsers();
      expect(screen.getByText("Disabled")).toBeInTheDocument();
      expect(menuItem("Enable Bob")).toBeInTheDocument();
    });

    it("resets a password", async () => {
      vi.mocked(admin.resetAdminPassword).mockResolvedValue(undefined);
      await openUsers();
      fireEvent.click(menuItem("Reset password for Bob"));
      const dialog = screen.getByRole("dialog");
      const submit = within(dialog).getByRole("button", { name: "Reset password" });
      expect(submit).toBeDisabled();
      fireEvent.change(within(dialog).getByLabelText(/^New password/), { target: { value: "brandnew123" } });
      fireEvent.click(submit);
      await waitFor(() => expect(admin.resetAdminPassword).toHaveBeenCalledWith("u1", "brandnew123"));
    });

    it("only deletes after typing the username", async () => {
      vi.mocked(admin.deleteAdminUser).mockResolvedValue(undefined);
      await openUsers();
      fireEvent.click(menuItem("Delete Bob"));
      const dialog = screen.getByRole("dialog");
      const submit = within(dialog).getByRole("button", { name: "Delete" });
      expect(submit).toBeDisabled();
      fireEvent.change(within(dialog).getByLabelText(/Type bob to confirm/), { target: { value: "bo" } });
      expect(submit).toBeDisabled();
      fireEvent.change(within(dialog).getByLabelText(/Type bob to confirm/), { target: { value: "bob" } });
      fireEvent.click(submit);
      await waitFor(() => expect(admin.deleteAdminUser).toHaveBeenCalledWith("u1"));
    });

    it("closes a dialog with Escape or Cancel", async () => {
      await openUsers();
      fireEvent.click(menuItem("Edit Bob"));
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("dialog")).toBeNull();
      fireEvent.click(menuItem("Edit Bob"));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("offers a retry when the list can't load", async () => {
      vi.mocked(admin.listAdminUsers).mockRejectedValueOnce(new Error("down"));
      render(<AdminPanel currentUserId="me" />);
      openTab("Users");
      expect(await screen.findByRole("alert")).toHaveTextContent("down");
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(await screen.findByText("Bob")).toBeInTheDocument();
    });
  });

  describe("system", () => {
    it("shows each service's state and the cache sizes", async () => {
      render(<AdminPanel currentUserId="me" />);
      openTab("System");
      expect(await screen.findByText("TMDB_API_KEY is not set")).toBeInTheDocument();
      expect(screen.getAllByRole("img", { name: "OK" })).toHaveLength(5);
      expect(screen.getAllByRole("img", { name: "Problem" })).toHaveLength(1);
      expect(screen.getByText(/2 files, 2.0 KB/)).toBeInTheDocument();
      expect(screen.getByText("3.12.1")).toBeInTheDocument();
    });

    it("clears a cache and refreshes", async () => {
      vi.mocked(admin.clearTmdbCache).mockResolvedValue({ cleared: 5 });
      render(<AdminPanel currentUserId="me" />);
      openTab("System");
      fireEvent.click(await screen.findByRole("button", { name: "Clear TMDB cache" }));
      await waitFor(() => expect(showToast).toHaveBeenCalledWith("Cleared 5 items.", "success"));
      expect(admin.getSystemStatus).toHaveBeenCalledTimes(2);
    });

    it("toasts when clearing fails", async () => {
      vi.mocked(admin.clearSubtitleCache).mockRejectedValue(new Error("disk"));
      render(<AdminPanel currentUserId="me" />);
      openTab("System");
      fireEvent.click(await screen.findByRole("button", { name: "Clear subtitle cache" }));
      await waitFor(() => expect(showToast).toHaveBeenCalledWith("disk"));
    });
  });
});
