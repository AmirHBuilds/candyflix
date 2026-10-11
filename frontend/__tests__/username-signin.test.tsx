import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }), usePathname: () => "/login", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn().mockResolvedValue(null),
  listUsers: vi.fn().mockResolvedValue([{ id: "1", username: "candy", display_name: "Candy", avatar_url: null, created_at: "2026-01-01T00:00:00Z", is_admin: false }]),
  login: vi.fn(),
  verifyLoginCode: vi.fn(),
  resendLoginCode: vi.fn(),
}));
vi.mock("@/lib/site", async (orig) => ({ ...(await orig<typeof import("@/lib/site")>()), getBadge: vi.fn().mockResolvedValue({}) }));

import LoginPage from "@/app/login/page";
import * as auth from "@/lib/auth";
import { AGE_LIMITS } from "@/lib/age-limit";

beforeEach(() => vi.clearAllMocks());

async function openForm() {
  render(<LoginPage />);
  await screen.findByText("Candy");
  fireEvent.click(screen.getByRole("button", { name: /Sign in with a username/ }));
}

describe("sign in with a username", () => {
  it("is offered under the profiles, and signs in with what was typed", async () => {
    vi.mocked(auth.login).mockResolvedValue({ kind: "signed_in", user: { id: "9" } as never });
    await openForm();
    expect(screen.queryByText("Who's watching?")).toBeNull();
    const go = screen.getByRole("button", { name: "Continue" });
    expect(go).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "  amir " } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw123456" } });
    fireEvent.click(go);
    await waitFor(() => expect(auth.login).toHaveBeenCalledWith("amir", "pw123456"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
  });

  it("says plainly when it doesn't match, and goes back to the profiles", async () => {
    vi.mocked(auth.login).mockRejectedValue(new Error("Incorrect username or password"));
    await openForm();
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "amir" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrongwrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That username and password don't match");
    fireEvent.click(screen.getByRole("button", { name: /Back to profiles/ }));
    expect(await screen.findByText("Who's watching?")).toBeInTheDocument();
  });

  it("still asks for the Telegram code when two-step is on", async () => {
    vi.mocked(auth.login).mockResolvedValue({ kind: "code", challenge: "chal-123456" });
    await openForm();
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "amir" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByLabelText("Sign-in code")).toBeInTheDocument();
  });
});

describe("small things", () => {
  it("every age limit says what age it is for", () => {
    for (const l of AGE_LIMITS) expect(l.label).toMatch(/\d|all ages/);
  });

  it("the global scrollbar rule leaves rows that hide theirs alone", () => {
    const css = readFileSync(join(__dirname, "../app/globals.css"), "utf8");
    expect(css).toContain('.overflow-x-auto:not([class*="scrollbar-width:none"])');
  });
});
