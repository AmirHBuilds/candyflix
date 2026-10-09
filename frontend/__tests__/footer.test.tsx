import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FooterView } from "@/components/Footer";
import FooterTab from "@/components/admin/FooterTab";
import * as admin from "@/lib/admin";
import { DEFAULT_FOOTER } from "@/lib/site";

vi.mock("@/lib/admin", () => ({ getAdminFooter: vi.fn(), saveAdminFooter: vi.fn() }));
vi.mock("@/lib/toast", () => ({ showToast: vi.fn() }));

const footer = { ...DEFAULT_FOOTER, email: "hi@example.com", links: [{ label: "Help", url: "https://example.com/help" }, { label: "About", url: "/about" }] };

describe("FooterView", () => {
  it("shows tagline, email, links and the year", () => {
    render(<FooterView footer={footer} year={2026} />);
    expect(screen.getByText(DEFAULT_FOOTER.tagline)).toBeTruthy();
    expect(screen.getByRole("link", { name: "hi@example.com" }).getAttribute("href")).toBe("mailto:hi@example.com");
    expect(screen.getByRole("link", { name: "Help" }).getAttribute("target")).toBe("_blank");
    expect(screen.getByRole("link", { name: "About" }).getAttribute("href")).toBe("/about");
    expect(screen.getByText(/© 2026 CandyFlix/)).toBeTruthy();
  });
  it("when disabled only the fixed love note remains, and empty parts are hidden", () => {
    const { container, rerender } = render(<FooterView footer={{ ...footer, enabled: false }} year={2026} />);
    expect(container.textContent).toBe("Made with all my love, for Candy 💗");
    expect(screen.queryByRole("link")).toBeNull();
    rerender(<FooterView footer={{ ...DEFAULT_FOOTER, email: "" }} year={2026} />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("FooterTab", () => {
  beforeEach(() => {
    vi.mocked(admin.getAdminFooter).mockReset().mockResolvedValue(footer);
    vi.mocked(admin.saveAdminFooter).mockReset().mockImplementation(async (f) => f);
  });

  it("loads, edits and saves the footer", async () => {
    const user = userEvent.setup();
    render(<FooterTab />);
    const email = await screen.findByLabelText(/Contact email/);
    await user.clear(email);
    await user.type(email, "new@example.com");
    await user.click(screen.getByRole("button", { name: "Add a link" }));
    await user.type(screen.getByLabelText("Link 3 label"), "Docs");
    await user.type(screen.getByLabelText("Link 3 address"), "https://d.io");
    await user.click(screen.getByRole("button", { name: "Remove link 1" }));
    await user.click(screen.getByRole("button", { name: "Save footer" }));
    await waitFor(() => expect(admin.saveAdminFooter).toHaveBeenCalled());
    const sent = vi.mocked(admin.saveAdminFooter).mock.calls[0][0];
    expect(sent.email).toBe("new@example.com");
    expect(sent.links.map((l) => l.label)).toEqual(["About", "Docs"]);
  });

  it("shows a load error", async () => {
    vi.mocked(admin.getAdminFooter).mockRejectedValue(new Error("nope"));
    render(<FooterTab />);
    expect((await screen.findByRole("alert")).textContent).toBe("nope");
  });
});
