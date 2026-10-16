import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/lib/admin", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin")>("@/lib/admin");
  return { ...actual, getNotices: vi.fn(), markNoticesRead: vi.fn(), setRest: vi.fn(), getSharing: vi.fn(), getSharingConfig: vi.fn(), saveSharingConfig: vi.fn() };
});
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/lib/toast", () => ({ showToast: toast }));

import NoticeBell from "@/components/admin/NoticeBell";
import SecurityTab from "@/components/admin/SecurityTab";
import * as admin from "@/lib/admin";

const notice = (over = {}) => ({ id: "n1", at: "2026-10-15T10:00:00Z", kind: "feedback", title: "Candy sent a problem", body: "Subtitles are early", link: "feedback", user_id: "u1", user_name: "Candy", unread: true, ...over });
const notices = (over = {}) => ({ items: [notice()], unread: 1, resting: false, rest_until: null, rest_forever: false, server_time: "2026-10-15T10:00:30Z", ...over });

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

describe("notification bell", () => {
  it("shows what is new, and leads to the right tab", async () => {
    vi.mocked(admin.getNotices).mockResolvedValue(notices());
    render(<NoticeBell />);
    fireEvent.click(await screen.findByRole("button", { name: "Notifications, 1 new" }));
    const link = screen.getByRole("link", { name: /Candy sent a problem/ });
    expect(link).toHaveAttribute("href", "/admin?tab=feedback");
    expect(screen.getByText("Subtitles are early")).toBeInTheDocument();
    expect(toast).not.toHaveBeenCalled(); // what was already there when the page opened does not pop up
  });

  it("pops up a notice that arrives while the admin is on the site, once", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(admin.getNotices).mockResolvedValueOnce(notices());
    vi.mocked(admin.getNotices).mockResolvedValue(
      notices({ items: [notice({ id: "n2", at: "2026-10-15T10:01:00Z", kind: "sharing", title: "Sara signed in from 4 different addresses", link: "security" }), notice()], unread: 2 })
    );
    render(<NoticeBell />);
    await screen.findByRole("button", { name: /Notifications/ });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31000);
    });
    expect(toast).toHaveBeenCalledWith("Sara signed in from 4 different addresses", "info", expect.any(Number));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31000);
    });
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("stays quiet while resting, hides the badge, and lets the admin switch it back on", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const resting = notices({ resting: true, rest_forever: true });
    vi.mocked(admin.getNotices).mockResolvedValueOnce(notices());
    vi.mocked(admin.getNotices).mockResolvedValue({ ...resting, items: [notice({ id: "n3", at: "2026-10-15T10:05:00Z", title: "New one" }), notice()], unread: 2 });
    vi.mocked(admin.setRest).mockResolvedValue(notices());
    render(<NoticeBell />);
    await screen.findByRole("button", { name: /Notifications/ });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31000);
    });
    expect(toast).not.toHaveBeenCalled();
    const bell = screen.getByRole("button", { name: "Notifications, resting" });
    fireEvent.click(bell);
    expect(screen.getByText(/Resting until you switch/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Switch notifications on" }));
    await waitFor(() => expect(admin.setRest).toHaveBeenCalledWith(0));
  });

  it("offers rest choices and sends the length", async () => {
    vi.mocked(admin.getNotices).mockResolvedValue(notices());
    vi.mocked(admin.setRest).mockResolvedValue(notices({ resting: true }));
    render(<NoticeBell />);
    fireEvent.click(await screen.findByRole("button", { name: /Notifications/ }));
    fireEvent.click(screen.getByRole("button", { name: "Rest: 8 hours" }));
    await waitFor(() => expect(admin.setRest).toHaveBeenCalledWith(480));
    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    await waitFor(() => expect(admin.markNoticesRead).toHaveBeenCalled());
  });
});

describe("Security tab", () => {
  const overview = {
    window_hours: 24, max_ips: 3, enabled: true,
    people: [
      { user_id: "u1", username: "sara", display_name: "Sara", avatar_url: null, is_disabled: false, distinct_ips: 3, sign_ins: 5, flagged: true,
        ips: [{ ip: "1.1.1.1", sign_ins: 2, first_at: "2026-10-15T08:00:00Z", last_at: "2026-10-15T09:00:00Z", devices: ["Chrome on Windows"] }, { ip: "2.2.2.2", sign_ins: 3, first_at: "2026-10-15T08:30:00Z", last_at: "2026-10-15T09:30:00Z", devices: ["Safari on iOS"] }] },
    ],
  };
  beforeEach(() => {
    vi.mocked(admin.getNotices).mockResolvedValue(notices());
    vi.mocked(admin.getSharing).mockResolvedValue(overview);
    vi.mocked(admin.getSharingConfig).mockResolvedValue({ enabled: true, max_ips: 3, window_hours: 24 });
  });

  it("lists who may be sharing, with every address and device, and opens the person", async () => {
    const onView = vi.fn();
    render(<SecurityTab onViewPerson={onView} />);
    expect(await screen.findByText("may be shared")).toBeInTheDocument();
    expect(screen.getByText("1.1.1.1")).toBeInTheDocument();
    expect(screen.getByText("Safari on iOS")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(onView).toHaveBeenCalledWith("u1");
  });

  it("saves new limits", async () => {
    vi.mocked(admin.saveSharingConfig).mockResolvedValue({ enabled: true, max_ips: 6, window_hours: 24 });
    render(<SecurityTab onViewPerson={vi.fn()} />);
    const input = await screen.findByLabelText("Different addresses");
    fireEvent.change(input, { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(admin.saveSharingConfig).toHaveBeenCalledWith({ enabled: true, max_ips: 6, window_hours: 24 }));
  });

  it("says so when nobody uses several addresses", async () => {
    vi.mocked(admin.getSharing).mockResolvedValue({ ...overview, people: [] });
    render(<SecurityTab onViewPerson={vi.fn()} />);
    expect(await screen.findByText(/Nobody has signed in from more than one address/)).toBeInTheDocument();
  });
});
