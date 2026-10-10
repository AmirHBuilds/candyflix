import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

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

beforeEach(() => vi.clearAllMocks());

async function toPassword() {
  render(<LoginPage />);
  fireEvent.click(await screen.findByText("Candy"));
  fireEvent.change(await screen.findByPlaceholderText("Password"), { target: { value: "pw123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

describe("login with two-step sign-in", () => {
  it("asks for the Telegram code after the password and signs in with it", async () => {
    vi.mocked(auth.login).mockResolvedValue({ kind: "code", challenge: "chal-123456" });
    vi.mocked(auth.verifyLoginCode).mockResolvedValue({ id: "1" } as never);
    await toPassword();
    const box = await screen.findByLabelText("Sign-in code");
    expect(push).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: "12ab34" } }); // letters are dropped
    expect(box).toHaveValue("1234");
    fireEvent.change(box, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(auth.verifyLoginCode).toHaveBeenCalledWith("chal-123456", "123456"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
  });

  it("shows a wrong code, and can ask for a new one", async () => {
    vi.mocked(auth.login).mockResolvedValue({ kind: "code", challenge: "chal-123456" });
    vi.mocked(auth.verifyLoginCode).mockRejectedValue(new Error("That code isn't right."));
    vi.mocked(auth.resendLoginCode).mockResolvedValue();
    await toPassword();
    fireEvent.change(await screen.findByLabelText("Sign-in code"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("isn't right");
    fireEvent.click(screen.getByRole("button", { name: "Send a new code" }));
    expect(await screen.findByText("A new code is on its way.")).toBeInTheDocument();
  });

  it("signs straight in when two-step is off", async () => {
    vi.mocked(auth.login).mockResolvedValue({ kind: "signed_in", user: { id: "1" } as never });
    await toPassword();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(screen.queryByLabelText("Sign-in code")).toBeNull();
  });
});
