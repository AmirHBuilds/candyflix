import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, waitFor, renderHook, cleanup } from "@testing-library/react";

vi.mock("@/lib/admin", () => ({
  getNowWatching: vi.fn(),
  getUserDetail: vi.fn(),
  getUserHistory: vi.fn(),
  getUserWatchlist: vi.fn(),
}));

import NowWatchingCard, { formatClock, whatLabel } from "@/components/admin/NowWatchingCard";
import UserDetailView from "@/components/admin/UserDetailView";
import { usePresence } from "@/components/player/usePresence";
import * as admin from "@/lib/admin";

const now: admin.NowWatching = {
  user_id: "u1",
  username: "bob",
  display_name: "Bob",
  avatar_url: null,
  tmdb_id: 1,
  media_type: "tv",
  season_number: 2,
  episode_number: 3,
  title: "Dark",
  poster_path: null,
  position_seconds: 125,
  duration_seconds: 3600,
  playing: true,
  since: "2026-10-05T10:00:00Z",
} as admin.NowWatching;

const user = {
  id: "u1",
  username: "bob",
  display_name: "Bob",
  is_admin: false,
  is_disabled: false,
  created_at: "2026-01-01T00:00:00Z",
  last_login_at: null,
  avatar_url: null,
  watchlist_count: 1,
  watched_count: 2,
} as admin.AdminUser;

const hist = (n: number): admin.HistoryItem => ({
  tmdb_id: n,
  media_type: "movie",
  season_number: null,
  episode_number: null,
  title: `Film ${n}`,
  poster_path: null,
  position_seconds: 60,
  duration_seconds: 120,
  fraction: 0.5,
  opened_only: false,
  updated_at: "2026-10-04T10:00:00Z",
});

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("helpers", () => {
  it("formats clocks and labels", () => {
    expect(formatClock(125)).toBe("2:05");
    expect(formatClock(3725)).toBe("1:02:05");
    expect(whatLabel(now)).toBe("Dark · S2E3");
    expect(whatLabel({ ...now, title: null, media_type: "movie", season_number: null, episode_number: null })).toBe("Movie #1");
  });
});

describe("NowWatchingCard", () => {
  it("shows who is watching what", async () => {
    vi.mocked(admin.getNowWatching).mockResolvedValue([now]);
    render(<NowWatchingCard />);
    expect(await screen.findByText(/Dark · S2E3/)).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("2:05 / 1:00:00")).toBeInTheDocument();
  });
  it("says so when nobody is watching", async () => {
    vi.mocked(admin.getNowWatching).mockResolvedValue([]);
    render(<NowWatchingCard />);
    expect(await screen.findByText("Nobody is watching right now.")).toBeInTheDocument();
  });
  it("polls", async () => {
    vi.mocked(admin.getNowWatching).mockResolvedValue([]);
    render(<NowWatchingCard intervalMs={20} />);
    await waitFor(() => expect(vi.mocked(admin.getNowWatching).mock.calls.length).toBeGreaterThan(2));
  });
});

describe("UserDetailView", () => {
  beforeEach(() => {
    vi.mocked(admin.getUserDetail).mockResolvedValue({ user, now_watching: now, active_sessions: 2, last_activity: null });
    vi.mocked(admin.getUserWatchlist).mockResolvedValue([
      { tmdb_id: 9, media_type: "movie", title: "Saved One", poster_path: null, added_at: "2026-09-01T00:00:00Z" },
    ]);
  });

  it("shows profile, now watching and pages through history", async () => {
    vi.mocked(admin.getUserHistory)
      .mockResolvedValueOnce({ items: [hist(1), hist(2)], total: 3 })
      .mockResolvedValueOnce({ items: [hist(3)], total: 3 });
    render(<UserDetailView userId="u1" onBack={() => {}} />);
    expect(await screen.findByText("@bob")).toBeInTheDocument();
    expect(screen.getByText(/2 active sign-ins/)).toBeInTheDocument();
    expect(screen.getByText(/watching/)).toBeInTheDocument();
    expect(await screen.findByText("Film 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Load more \(1 left\)/ }));
    expect(await screen.findByText("Film 3")).toBeInTheDocument();
    expect(vi.mocked(admin.getUserHistory)).toHaveBeenLastCalledWith("u1", 2, 50);
    expect(screen.queryByRole("button", { name: /Load more/ })).toBeNull();
  });

  it("shows the person's own box tab and goes back", async () => {
    vi.mocked(admin.getUserHistory).mockResolvedValue({ items: [], total: 0 });
    const onBack = vi.fn();
    render(<UserDetailView userId="u1" onBack={onBack} />);
    expect(await screen.findByText("No watch history yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Bob Box" }));
    expect(await screen.findByText("Saved One")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /All people/ }));
    expect(onBack).toHaveBeenCalled();
  });
});

describe("usePresence", () => {
  it("beats on mount and stops on unmount", () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const video = document.createElement("video");
    const { unmount } = renderHook(() => usePresence({ current: video }, { mediaType: "movie", tmdbId: 5 }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/presence$/);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ tmdb_id: 5, media_type: "movie", playing: false });
    unmount();
    const last = fetchMock.mock.calls.at(-1)!;
    expect(String(last[0])).toMatch(/\/presence\/stop$/);
    vi.unstubAllGlobals();
  });
});
