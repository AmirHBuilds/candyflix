import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

vi.mock("@/lib/announcements", () => ({ getPendingAnnouncements: vi.fn(), acknowledgeAnnouncement: vi.fn() }));
vi.mock("@/lib/admin", () => ({
  listAnnouncements: vi.fn(),
  getAnnouncement: vi.fn(),
  getAnnouncementTargets: vi.fn(),
  createAnnouncement: vi.fn(),
  updateAnnouncement: vi.fn(),
  reshowAnnouncement: vi.fn(),
  deleteAnnouncement: vi.fn(),
  listAdminUsers: vi.fn(),
}));
vi.mock("@/lib/toast", () => ({ showToast: vi.fn() }));

import AnnouncementBanner from "@/components/AnnouncementBanner";
import MessagesTab from "@/components/admin/MessagesTab";
import * as api from "@/lib/announcements";
import * as admin from "@/lib/admin";

const msg = (id: string, title: string) => ({ id, title, body: `Body of ${title}\nsecond line`, created_at: "2026-10-05T10:00:00Z" });
const ann = (over: Partial<admin.Announcement> = {}): admin.Announcement => ({
  id: "a1", title: "Maintenance", body: "Back at 9.", audience: "all", created_at: "2026-10-05T10:00:00Z", created_by_name: "Candy",
  expires_at: null, is_active: true, status: "active", recipients: 3, accepted: 1, ...over,
});
const detail = (over: Partial<admin.AnnouncementDetail> = {}): admin.AnnouncementDetail => ({
  ...ann(),
  people: [
    { user_id: "u1", username: "bob", display_name: "Bob", avatar_url: null, acked_at: "2026-10-05T11:00:00Z" },
    { user_id: "u2", username: "eve", display_name: "Eve", avatar_url: null, acked_at: null },
  ],
  ...over,
});

beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

describe("AnnouncementBanner", () => {
  it("renders nothing without messages", async () => {
    vi.mocked(api.getPendingAnnouncements).mockResolvedValue([]);
    const { container } = render(<AnnouncementBanner />);
    await waitFor(() => expect(api.getPendingAnnouncements).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("shows each message until 'I understand' is pressed, and only that one goes", async () => {
    vi.mocked(api.getPendingAnnouncements).mockResolvedValue([msg("1", "First"), msg("2", "Second")]);
    vi.mocked(api.acknowledgeAnnouncement).mockResolvedValue();
    render(<AnnouncementBanner />);
    expect(await screen.findByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "I understand" })[0]);
    await waitFor(() => expect(screen.queryByText("First")).toBeNull());
    expect(api.acknowledgeAnnouncement).toHaveBeenCalledWith("1");
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("keeps the message and says so when saving fails", async () => {
    vi.mocked(api.getPendingAnnouncements).mockResolvedValue([msg("1", "First")]);
    vi.mocked(api.acknowledgeAnnouncement).mockRejectedValue(new Error("Couldn't save that. Please try again."));
    render(<AnnouncementBanner />);
    fireEvent.click(await screen.findByRole("button", { name: "I understand" }));
    expect(await screen.findByText("Couldn't save that. Please try again.")).toBeInTheDocument();
    expect(screen.getByText("First")).toBeInTheDocument();
  });

  it("keeps what is on screen when a refresh fails", async () => {
    vi.mocked(api.getPendingAnnouncements).mockResolvedValueOnce([msg("1", "First")]).mockRejectedValue(new Error("down"));
    render(<AnnouncementBanner />);
    expect(await screen.findByText("First")).toBeInTheDocument();
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(api.getPendingAnnouncements).toHaveBeenCalledTimes(2));
    expect(screen.getByText("First")).toBeInTheDocument();
  });
});

describe("MessagesTab", () => {
  beforeEach(() => {
    vi.mocked(admin.listAnnouncements).mockResolvedValue([ann()]);
    vi.mocked(admin.getAnnouncement).mockResolvedValue(detail());
    vi.mocked(admin.listAdminUsers).mockResolvedValue([
      { id: "u1", username: "bob", display_name: "Bob" } as admin.AdminUser,
      { id: "u2", username: "eve", display_name: "Eve" } as admin.AdminUser,
    ]);
  });

  it("lists messages with how many understood", async () => {
    render(<MessagesTab />);
    expect(await screen.findByText("Maintenance")).toBeInTheDocument();
    expect(screen.getByText("1 of 3 understood")).toBeInTheDocument();
    expect(screen.getByText("Showing")).toBeInTheDocument();
  });

  it("says when there are none", async () => {
    vi.mocked(admin.listAnnouncements).mockResolvedValue([]);
    render(<MessagesTab />);
    expect(await screen.findByText("No messages yet.")).toBeInTheDocument();
  });

  it("sends a message to chosen people (needs a title, text and at least one person)", async () => {
    vi.mocked(admin.createAnnouncement).mockResolvedValue(ann({ id: "new", audience: "selected" }));
    render(<MessagesTab />);
    fireEvent.click(await screen.findByRole("button", { name: "New message" }));
    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Hello" } });
    fireEvent.change(screen.getByRole("textbox", { name: /^Message/ }), { target: { value: "Please read" } });
    expect(send).toBeEnabled(); // everyone is the default
    fireEvent.click(screen.getByLabelText(/Only people I choose/));
    expect(send).toBeDisabled();
    fireEvent.click(await screen.findByLabelText(/@eve/));
    expect(send).toBeEnabled();
    fireEvent.click(send);
    await waitFor(() =>
      expect(admin.createAnnouncement).toHaveBeenCalledWith({ title: "Hello", body: "Please read", audience: "selected", user_ids: ["u2"], expires_at: null }),
    );
    expect(await screen.findByText("Who understood")).toBeInTheDocument(); // opens the new message
  });

  it("shows who understood and who didn't, and the actions work", async () => {
    vi.mocked(admin.updateAnnouncement).mockResolvedValue(ann({ is_active: false, status: "stopped" }));
    vi.mocked(admin.reshowAnnouncement).mockResolvedValue({ cleared: 1 });
    vi.mocked(admin.deleteAnnouncement).mockResolvedValue();
    render(<MessagesTab />);
    fireEvent.click(await screen.findByText("Maintenance"));
    expect(await screen.findByText(/Understood/)).toBeInTheDocument();
    expect(screen.getByText("Not yet")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Stop showing" }));
    await waitFor(() => expect(admin.updateAnnouncement).toHaveBeenCalledWith("a1", { is_active: false }));

    fireEvent.click(screen.getByRole("button", { name: "Ask everyone again" }));
    await waitFor(() => expect(admin.reshowAnnouncement).toHaveBeenCalledWith("a1"));

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(admin.deleteAnnouncement).not.toHaveBeenCalled(); // needs a second click
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete it" }));
    await waitFor(() => expect(admin.deleteAnnouncement).toHaveBeenCalledWith("a1"));
  });

  it("edits: loads the chosen people and saves changes", async () => {
    vi.mocked(admin.getAnnouncement).mockResolvedValue(detail({ audience: "selected" }));
    vi.mocked(admin.getAnnouncementTargets).mockResolvedValue(["u1"]);
    vi.mocked(admin.updateAnnouncement).mockResolvedValue(ann());
    render(<MessagesTab />);
    fireEvent.click(await screen.findByText("Maintenance"));
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const bob = (await screen.findByLabelText(/@bob/)) as HTMLInputElement;
    await waitFor(() => expect(bob.checked).toBe(true));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(admin.updateAnnouncement).toHaveBeenCalledWith("a1", expect.objectContaining({ title: "Changed", audience: "selected", user_ids: ["u1"] })),
    );
  });
});
