import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/account", () => ({
  updateDisplayName: vi.fn(),
  changePassword: vi.fn(),
  uploadAvatar: vi.fn(),
  removeAvatar: vi.fn(),
  getTwoFactor: vi.fn(),
  startTwoFactor: vi.fn(),
  stopTwoFactor: vi.fn(),
  getSessions: vi.fn(),
  signOutDevice: vi.fn(),
  signOutOtherDevices: vi.fn(),
}));
vi.mock("@/lib/toast", () => ({ showToast: vi.fn() }));

import AccountSettingsForm from "@/components/settings/AccountSettingsForm";
import * as account from "@/lib/account";
import { showToast } from "@/lib/toast";

const user = { id: "1", username: "candy", display_name: "Candy", avatar_url: null, created_at: "2026-01-01T00:00:00Z" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(account.getTwoFactor).mockResolvedValue({ available: true, enabled: false });
  vi.mocked(account.getSessions).mockResolvedValue([]);
});

describe("Account settings", () => {
  it("shows the username read-only", () => {
    render(<AccountSettingsForm user={user} />);
    const field = screen.getByLabelText("Username");
    expect(field).toHaveValue("candy");
    expect(field).toHaveAttribute("readonly");
  });

  it("keeps Save disabled until the name changes, then saves it", async () => {
    vi.mocked(account.updateDisplayName).mockResolvedValue({ ...user, display_name: "Sweet" });
    render(<AccountSettingsForm user={user} />);
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Sweet" } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(account.updateDisplayName).toHaveBeenCalledWith("Sweet"));
    await waitFor(() => expect(save).toBeDisabled());
  });

  it("toasts the reason when saving the name fails", async () => {
    vi.mocked(account.updateDisplayName).mockRejectedValue(new Error("nope"));
    render(<AccountSettingsForm user={user} />);
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("nope"));
  });

  it("uploads a picture and offers to remove it", async () => {
    vi.mocked(account.uploadAvatar).mockResolvedValue({ ...user, avatar_url: "/avatars/a.webp" });
    render(<AccountSettingsForm user={user} />);
    const file = new File(["x"], "me.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Choose a profile picture"), { target: { files: [file] } });
    await waitFor(() => expect(account.uploadAvatar).toHaveBeenCalledWith(file));
    expect(await screen.findByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("shows an upload error as a toast", async () => {
    vi.mocked(account.uploadAvatar).mockRejectedValue(new Error("That file isn't a picture."));
    render(<AccountSettingsForm user={user} />);
    fireEvent.change(screen.getByLabelText("Choose a profile picture"), {
      target: { files: [new File(["x"], "a.txt")] },
    });
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("That file isn't a picture."));
  });

  it("removes the picture", async () => {
    vi.mocked(account.removeAvatar).mockResolvedValue({ ...user, avatar_url: null });
    render(<AccountSettingsForm user={{ ...user, avatar_url: "/avatars/a.webp" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(account.removeAvatar).toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: "Upload" })).toBeInTheDocument();
  });

  describe("password", () => {
    const fill = (cur: string, next: string, confirm: string) => {
      fireEvent.change(screen.getByLabelText("Current password"), { target: { value: cur } });
      fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: next } });
      fireEvent.change(screen.getByLabelText(/^Confirm new password/), { target: { value: confirm } });
    };

    it("needs 8+ characters and a matching confirmation", () => {
      render(<AccountSettingsForm user={user} />);
      const btn = screen.getByRole("button", { name: "Change password" });
      fill("old", "short", "short");
      expect(btn).toBeDisabled();
      fill("old", "longenough1", "different1");
      expect(btn).toBeDisabled();
      expect(screen.getByRole("alert")).toHaveTextContent("match");
      fill("old", "longenough1", "longenough1");
      expect(btn).toBeEnabled();
    });

    it("changes it and clears the fields", async () => {
      vi.mocked(account.changePassword).mockResolvedValue(undefined);
      render(<AccountSettingsForm user={user} />);
      fill("old", "longenough1", "longenough1");
      fireEvent.click(screen.getByRole("button", { name: "Change password" }));
      await waitFor(() => expect(account.changePassword).toHaveBeenCalledWith("old", "longenough1"));
      await waitFor(() => expect(screen.getByLabelText("Current password")).toHaveValue(""));
    });

    it("shows the server's reason inline when it fails", async () => {
      vi.mocked(account.changePassword).mockRejectedValue(new Error("Your current password is incorrect."));
      render(<AccountSettingsForm user={user} />);
      fill("bad", "longenough1", "longenough1");
      fireEvent.click(screen.getByRole("button", { name: "Change password" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("current password is incorrect");
    });
  });

  describe("two-step sign-in", () => {
    it("is disabled when the server has no Telegram bot", async () => {
      vi.mocked(account.getTwoFactor).mockResolvedValue({ available: false, enabled: false });
      render(<AccountSettingsForm user={user} />);
      expect(await screen.findByText(/no Telegram bot/)).toBeInTheDocument();
      expect(screen.getByRole("switch", { name: "Two-step sign-in" })).toBeDisabled();
    });

    it("asks for the password, then shows the bot link and notices the connection", async () => {
      vi.mocked(account.getTwoFactor).mockResolvedValue({ available: true, enabled: false });
      vi.mocked(account.startTwoFactor).mockResolvedValue("https://t.me/CandyBot?start=abc");
      render(<AccountSettingsForm user={user} />);
      fireEvent.click(await screen.findByRole("switch", { name: "Two-step sign-in" }));
      fireEvent.change(screen.getByLabelText("Your password"), { target: { value: "secret123" } });
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      const link = await screen.findByRole("link", { name: "Open Telegram" });
      expect(link).toHaveAttribute("href", "https://t.me/CandyBot?start=abc");
      expect(account.startTwoFactor).toHaveBeenCalledWith("secret123");
    });

    it("turning it off needs the password too", async () => {
      vi.mocked(account.getTwoFactor).mockResolvedValue({ available: true, enabled: true });
      vi.mocked(account.stopTwoFactor).mockResolvedValue();
      render(<AccountSettingsForm user={user} />);
      fireEvent.click(await screen.findByRole("switch", { name: "Two-step sign-in" }));
      fireEvent.change(screen.getByLabelText("Your password"), { target: { value: "secret123" } });
      fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
      await waitFor(() => expect(account.stopTwoFactor).toHaveBeenCalledWith("secret123"));
      await waitFor(() => expect(showToast).toHaveBeenCalledWith("Two-step sign-in is off.", "success"));
    });
  });
});

describe("Your devices", () => {
  const rows = [
    { id: "a1", at: "2026-10-15T10:00:00Z", device: "Chrome on Windows", ip: "1.1.1.1", current: true },
    { id: "b2", at: "2026-10-14T10:00:00Z", device: "Safari on iOS", ip: "2.2.2.2", current: false },
  ];

  it("lists the devices, marks this one, and signs another out", async () => {
    vi.mocked(account.getSessions).mockResolvedValue(rows);
    vi.mocked(account.signOutDevice).mockResolvedValue(undefined);
    render(<AccountSettingsForm user={user} />);
    expect(await screen.findByText("Chrome on Windows")).toBeInTheDocument();
    expect(screen.getByText("This device")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out Chrome on Windows" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign out Safari on iOS" }));
    await waitFor(() => expect(account.signOutDevice).toHaveBeenCalledWith("b2"));
    await waitFor(() => expect(account.getSessions).toHaveBeenCalledTimes(2));
  });

  it("signs out every other device at once, and only offers that when there is one", async () => {
    vi.mocked(account.getSessions).mockResolvedValue(rows);
    vi.mocked(account.signOutOtherDevices).mockResolvedValue(1);
    render(<AccountSettingsForm user={user} />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign out all other devices" }));
    await waitFor(() => expect(account.signOutOtherDevices).toHaveBeenCalled());
    expect(showToast).toHaveBeenCalledWith("Signed out of 1 other device.", "success");
  });

  it("hides the bulk button when this is the only device", async () => {
    vi.mocked(account.getSessions).mockResolvedValue([rows[0]]);
    render(<AccountSettingsForm user={user} />);
    await screen.findByText("This device");
    expect(screen.queryByRole("button", { name: "Sign out all other devices" })).not.toBeInTheDocument();
  });
});
