import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";

vi.mock("@/lib/admin", () => ({
  listAdminUsers: vi.fn(),
  getAdminStats: vi.fn(),
  getNowWatching: vi.fn(),
  getUserDetail: vi.fn(),
  getUserHistory: vi.fn(),
  getUserWatchlist: vi.fn(),
  getTitlesWatched: vi.fn(),
  getTitleViewers: vi.fn(),
  getDayActivity: vi.fn(),
  getSignIns: vi.fn(),
  getSystemStatus: vi.fn(),
}));
vi.mock("@/lib/toast", () => ({ showToast: vi.fn() }));

import AdminPanel from "@/components/admin/AdminPanel";
import { applyFilter } from "@/components/admin/UsersTab";
import * as admin from "@/lib/admin";

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400_000).toISOString();
const u = (over: Partial<admin.AdminUser>): admin.AdminUser =>
  ({ id: "u", username: "x", display_name: "X", is_admin: false, is_disabled: false, created_at: iso(30), last_login_at: null, avatar_url: null, watchlist_count: 0, watched_count: 0, ...over }) as admin.AdminUser;
const me = u({ id: "me", username: "root", display_name: "Root", is_admin: true, last_login_at: iso(1) });
const bob = u({ id: "bob", username: "bob", display_name: "Bob", last_login_at: iso(20) });
const eve = u({ id: "eve", username: "eve", display_name: "Eve", is_disabled: true });

const stats = {
  users_total: 3, admins: 1, disabled: 1, active_last_7_days: 1, watchlist_items: 0, watched_items: 4,
  activity: [{ date: "2026-10-04", saves: 3, active_users: 2 }, { date: "2026-10-05", saves: 0, active_users: 0 }],
  top_titles: [{ tmdb_id: 603, media_type: "movie", title: "The Matrix", viewers: 2 }],
  recent_logins: [],
} as admin.AdminStats;

const viewer = (name: string): admin.ViewerItem =>
  ({ tmdb_id: 603, media_type: "movie", season_number: null, episode_number: null, title: "The Matrix", poster_path: null, position_seconds: 60, duration_seconds: 120, fraction: 0.5, opened_only: false, updated_at: iso(0), user_id: "bob", username: "bob", display_name: name, avatar_url: null }) as admin.ViewerItem;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(admin.listAdminUsers).mockResolvedValue([me, bob, eve]);
  vi.mocked(admin.getAdminStats).mockResolvedValue(stats);
  vi.mocked(admin.getNowWatching).mockResolvedValue([]);
  vi.mocked(admin.getUserDetail).mockResolvedValue({ user: bob, now_watching: null, active_sessions: 0, last_activity: null });
  vi.mocked(admin.getUserHistory).mockResolvedValue({ items: [], total: 0 });
  vi.mocked(admin.getUserWatchlist).mockResolvedValue([]);
});
afterEach(cleanup);

describe("applyFilter", () => {
  it("filters admins, disabled and active in the last 7 days", () => {
    const all = [me, bob, eve];
    expect(applyFilter(all, "admins")).toEqual([me]);
    expect(applyFilter(all, "disabled")).toEqual([eve]);
    expect(applyFilter(all, "active")).toEqual([me]);
    expect(applyFilter(all)).toEqual(all);
  });
});

describe("Overview drill-down", () => {
  it("opens a filtered people list and goes back", async () => {
    render(<AdminPanel currentUserId="me" />);
    fireEvent.click(await screen.findByRole("button", { name: /^Disabled: 1/ }));
    expect(await screen.findByRole("heading", { name: "Disabled accounts" })).toBeInTheDocument();
    expect(screen.getByText("Eve")).toBeInTheDocument();
    expect(screen.queryByText("Bob")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /← Overview/ }));
    expect(await screen.findByRole("button", { name: /^People: 3/ })).toBeInTheDocument();
  });

  it("Marked watched -> titles -> who watched -> person, and back through each level", async () => {
    vi.mocked(admin.getTitlesWatched).mockResolvedValue({
      items: [{ tmdb_id: 603, media_type: "movie", title: "The Matrix", poster_path: null, viewers: 2, entries: 2, last_watched_at: iso(0) }],
      total: 1,
    });
    vi.mocked(admin.getTitleViewers).mockResolvedValue({ items: [viewer("Bob")], total: 1 });
    render(<AdminPanel currentUserId="me" />);
    fireEvent.click(await screen.findByRole("button", { name: /^Marked watched: 4/ }));
    fireEvent.click(await screen.findByRole("button", { name: /The Matrix/ }));
    expect(await screen.findByText("Who has watched this, and how far they got.")).toBeInTheDocument();
    expect(vi.mocked(admin.getTitleViewers)).toHaveBeenCalledWith("movie", 603, 0, 50);
    fireEvent.click(await screen.findByRole("button", { name: "Open Bob" }));
    expect(await screen.findByText("@bob")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /← The Matrix/ }));
    expect(await screen.findByRole("button", { name: "Open Bob" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /← Everything watched/ }));
    fireEvent.click(await screen.findByRole("button", { name: /← Overview/ }));
    expect(await screen.findByRole("button", { name: /^Marked watched/ })).toBeInTheDocument();
  });

  it("a bar opens that day's activity; empty days are not clickable", async () => {
    vi.mocked(admin.getDayActivity).mockResolvedValue({ items: [viewer("Bob")], total: 1 });
    render(<AdminPanel currentUserId="me" />);
    expect(await screen.findByRole("button", { name: "Open 2026-10-04" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open 2026-10-05" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open 2026-10-04" }));
    expect(await screen.findByText(/The Matrix/)).toBeInTheDocument();
    expect(vi.mocked(admin.getDayActivity)).toHaveBeenCalledWith("2026-10-04", 0, 50);
  });

  it("Most watched title opens its viewers; sign-ins lists everyone with devices", async () => {
    vi.mocked(admin.getTitleViewers).mockResolvedValue({ items: [], total: 0 });
    vi.mocked(admin.getSignIns).mockResolvedValue([
      { id: "bob", username: "bob", display_name: "Bob", avatar_url: null, is_disabled: false, last_login_at: iso(1), active_sessions: 2 },
      { id: "eve", username: "eve", display_name: "Eve", avatar_url: null, is_disabled: true, last_login_at: null, active_sessions: 0 },
    ]);
    render(<AdminPanel currentUserId="me" />);
    fireEvent.click(await screen.findByRole("button", { name: /The Matrix/ }));
    expect(await screen.findByText("Nobody has watched this.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /← Overview/ }));
    const section = (await screen.findByRole("heading", { name: "Recent sign-ins" })).closest("div")!.parentElement!;
    fireEvent.click(within(section).getByRole("button", { name: "See all" }));
    expect(await screen.findByText("2 devices now")).toBeInTheDocument();
    expect(screen.getByText("0 devices now")).toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
  });

  it("shows an error and 'Load more' on long lists", async () => {
    vi.mocked(admin.getTitlesWatched).mockRejectedValueOnce(new Error("boom"));
    render(<AdminPanel currentUserId="me" />);
    fireEvent.click(await screen.findByRole("button", { name: /^Marked watched/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
  });
});
