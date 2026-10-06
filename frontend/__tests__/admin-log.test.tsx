import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

vi.mock("@/lib/admin", () => ({ getAuditTrail: vi.fn(), getSignInLog: vi.fn() }));

import LogTab, { describe as describeEntry } from "@/components/admin/LogTab";
import * as admin from "@/lib/admin";

const entry = (over: Partial<admin.AuditEntry>): admin.AuditEntry => ({
  id: Math.random().toString(), at: "2026-10-05T10:00:00Z", actor_id: "a", actor_name: "Candy", action: "footer.update",
  target_user_id: null, target_name: null, detail: null, ...over,
});

beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

describe("describe()", () => {
  it("turns actions into sentences", () => {
    expect(describeEntry(entry({ action: "history.view", target_name: "Bob" }))).toBe("Candy looked at Bob's watch history");
    expect(describeEntry(entry({ action: "watchlist.view", target_name: "Bob" }))).toBe("Candy looked at Bob's Candy Box");
    expect(describeEntry(entry({ action: "user.password_reset", target_name: "Bob" }))).toBe("Candy reset Bob's password");
    expect(describeEntry(entry({ action: "announcement.create", target_name: "Hi" }))).toBe("Candy sent the message “Hi”");
    expect(describeEntry(entry({ action: "footer.update" }))).toBe("Candy edited the footer");
    expect(describeEntry(entry({ action: "something.new", target_name: "X" }))).toBe("Candy: something.new (X)");
  });
});

describe("LogTab", () => {
  it("lists admin actions with details and pages", async () => {
    vi.mocked(admin.getAuditTrail)
      .mockResolvedValueOnce({ items: [entry({ action: "user.update", target_name: "Bob", detail: "Changed username" })], total: 2 })
      .mockResolvedValueOnce({ items: [entry({ action: "user.delete", target_name: "Eve" })], total: 2 });
    render(<LogTab />);
    expect(await screen.findByText(/Candy edited Bob/)).toBeInTheDocument();
    expect(screen.getByText(/Changed username/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Load more \(1 left\)/ }));
    expect(await screen.findByText("Candy deleted Eve")).toBeInTheDocument();
    expect(admin.getAuditTrail).toHaveBeenLastCalledWith(1, 50);
  });

  it("says when empty, and shows the sign-in log with devices", async () => {
    vi.mocked(admin.getAuditTrail).mockResolvedValue({ items: [], total: 0 });
    vi.mocked(admin.getSignInLog).mockResolvedValue({
      items: [{ id: "1", at: "2026-10-05T09:00:00Z", user_id: "u", username: "bob", display_name: "Bob", avatar_url: null, device: "Chrome on Windows" }],
      total: 1,
    });
    render(<LogTab />);
    expect(await screen.findByText("Nothing has been logged yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Sign-ins" }));
    expect(await screen.findByText(/Chrome on Windows/)).toBeInTheDocument();
    expect(screen.getByText("Bob", { exact: false })).toBeInTheDocument();
  });

  it("shows an error", async () => {
    vi.mocked(admin.getAuditTrail).mockRejectedValue(new Error("boom"));
    render(<LogTab />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("boom"));
  });
});
