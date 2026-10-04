import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/account", () => ({
  updateDisplayName: vi.fn(),
  changePassword: vi.fn(),
  uploadAvatar: vi.fn(),
  removeAvatar: vi.fn(),
}));
vi.mock("@/lib/toast", () => ({ showToast: vi.fn() }));

import AccountSettingsForm from "@/components/settings/AccountSettingsForm";
import * as account from "@/lib/account";
import { showToast } from "@/lib/toast";

const user = { id: "1", username: "candy", display_name: "Candy", avatar_url: null, created_at: "2026-01-01T00:00:00Z" };

beforeEach(() => vi.clearAllMocks());

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

  it("shows two-factor as a disabled 'coming soon' switch", () => {
    render(<AccountSettingsForm user={user} />);
    expect(screen.getByRole("switch", { name: "Two-factor sign-in" })).toBeDisabled();
    expect(screen.getByText(/Telegram/)).toBeInTheDocument();
  });
});
