import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/lib/admin", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin")>("@/lib/admin");
  return { ...actual, getNotices: vi.fn(), markNoticesRead: vi.fn(), setRest: vi.fn(), getSharing: vi.fn(), getSharingConfig: vi.fn(), saveSharingConfig: vi.fn(), getLogins: vi.fn(), saveLoginConfig: vi.fn(), liftBlock: vi.fn(), getDeviceConfig: vi.fn(), saveDeviceConfig: vi.fn() };
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

const deviceCfg = (over = {}): admin.DeviceConfigOut => ({ enabled: true, max_devices_per_day: 3, max_active: 5, action: "alert", notify_user: true, country_available: true, ...over });
const cfg = { enabled: true, name_failures: 5, ip_failures: 20, window_minutes: 15, lockout_minutes: 15 };
const logins = (over = {}): admin.LoginsOverview => ({
  config: cfg,
  blocks: [{ scope: "name" as const, key: "candy", seconds_left: 600, since: "2026-10-15T10:00:00Z", until: "2026-10-15T10:15:00Z", fails: 5, minutes: 15, strikes: 2, others: ["5.5.5.5"] }],
  events: [
    { id: "e1", at: "2026-10-15T10:00:00Z", kind: "blocked" as const, username: "candy", ip: null, detail: "name: 5 wrong passwords; blocked for 15 min" },
    { id: "e2", at: "2026-10-15T09:59:00Z", kind: "failed" as const, username: "admin", ip: "5.5.5.5", detail: "wrong name or password" },
  ],
  two_step_available: true,
  without_two_step: [{ user_id: "u9", username: "sara", display_name: "Sara", is_admin: false }],
  ...over,
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
    vi.mocked(admin.getLogins).mockResolvedValue(logins());
    vi.mocked(admin.getDeviceConfig).mockResolvedValue(deviceCfg());
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

  it("lists who is blocked and from where, and lifts a block", async () => {
    vi.mocked(admin.liftBlock).mockResolvedValue(undefined);
    render(<SecurityTab onViewPerson={vi.fn()} />);
    expect((await screen.findAllByText("candy", { selector: "span.font-mono" })).length).toBe(2); // the block and its event
    expect(screen.getByText(/5 wrong passwords · 10 min left · from 5.5.5.5/)).toBeInTheDocument();
    expect(screen.getByText("repeat #2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Lift the block on candy" }));
    await waitFor(() => expect(admin.liftBlock).toHaveBeenCalledWith("name", "candy"));
    await waitFor(() => expect(admin.getLogins).toHaveBeenCalledTimes(2));
  });

  it("shows the recent wrong tries with the address they came from", async () => {
    render(<SecurityTab onViewPerson={vi.fn()} />);
    expect(await screen.findByText("wrong name or password")).toBeInTheDocument();
    expect(screen.getByText("blocked")).toBeInTheDocument();
    expect(screen.getAllByText("5.5.5.5").length).toBeGreaterThan(0);
  });

  it("says when nobody is blocked", async () => {
    vi.mocked(admin.getLogins).mockResolvedValue(logins({ blocks: [], events: [] }));
    render(<SecurityTab onViewPerson={vi.fn()} />);
    expect(await screen.findByText("Nobody is blocked.")).toBeInTheDocument();
    expect(screen.getByText("None yet.")).toBeInTheDocument();
  });

  it("saves new sign-in limits", async () => {
    vi.mocked(admin.saveLoginConfig).mockResolvedValue({ ...cfg, name_failures: 8 });
    render(<SecurityTab onViewPerson={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText("Wrong tries per name"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Save sign-in limits" }));
    await waitFor(() => expect(admin.saveLoginConfig).toHaveBeenCalledWith({ ...cfg, name_failures: 8 }));
  });

  it("reminds who has no two-step sign-in, only when the server can offer it", async () => {
    const { unmount } = render(<SecurityTab onViewPerson={vi.fn()} />);
    expect(await screen.findByText(/Not on yet: Sara/)).toBeInTheDocument();
    unmount();
    vi.mocked(admin.getLogins).mockResolvedValue(logins({ two_step_available: false, without_two_step: [] }));
    render(<SecurityTab onViewPerson={vi.fn()} />);
    await screen.findByText("Wrong passwords");
    expect(screen.queryByText("Two-step sign-in")).not.toBeInTheDocument();
  });

  it("changes the device limits and what happens at the limit", async () => {
    vi.mocked(admin.saveDeviceConfig).mockResolvedValue(deviceCfg({ max_devices_per_day: 2, action: "refuse" }));
    render(<SecurityTab onViewPerson={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText("Different devices per day"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("At the limit"), { target: { value: "refuse" } });
    fireEvent.click(screen.getByRole("button", { name: "Save device limits" }));
    await waitFor(() => expect(admin.saveDeviceConfig).toHaveBeenCalledWith({ enabled: true, max_devices_per_day: 2, max_active: 5, action: "refuse", notify_user: true }));
  });

  it("says when the server has no country file", async () => {
    vi.mocked(admin.getDeviceConfig).mockResolvedValue(deviceCfg({ country_available: false }));
    render(<SecurityTab onViewPerson={vi.fn()} />);
    expect(await screen.findByText(/Countries show as unknown/)).toBeInTheDocument();
  });

  it("shows the country next to an address", async () => {
    vi.mocked(admin.getSharing).mockResolvedValue({ ...overview, people: [{ ...overview.people[0], ips: [{ ...overview.people[0].ips[0], country: "FR" }, overview.people[0].ips[1]] }] });
    render(<SecurityTab onViewPerson={vi.fn()} />);
    expect(await screen.findByText("France")).toBeInTheDocument();
  });
});
