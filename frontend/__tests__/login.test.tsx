import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LoginPage from "@/app/login/page";

// This test mounts the REAL login/page.tsx component (the exact file
// that ships to the browser) in a real DOM (jsdom), and drives it with
// real user-event clicks/typing. Its network calls go to the actual
// running backend on http://localhost:8000 — nothing here is mocked
// except next/navigation's router (required outside the Next.js
// runtime) and getCurrentUser's initial "am I already logged in?"
// check (mocked to resolve null so the picker renders, matching a
// fresh browser with no session cookie yet).

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    getCurrentUser: vi.fn().mockResolvedValue(null),
  };
});

beforeEach(() => {
  pushMock.mockClear();
});

describe("Who's Watching login page — real component, real backend", () => {
  it("renders the actual seeded profiles from the running backend", async () => {
    render(<LoginPage />);

    expect(screen.getByText(/who's watching/i)).toBeInTheDocument();

    // These names come from a live GET /api/auth/users call to the
    // real backend — not fixtures, not hardcoded in the component.
    expect(await screen.findByText("Candy")).toBeInTheDocument();
    expect(await screen.findByText("Mom")).toBeInTheDocument();
    expect(await screen.findByText("Sister")).toBeInTheDocument();
  });

  it("logs in as Candy end to end and navigates home", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    const candyButton = await screen.findByText("Candy");
    await user.click(candyButton);

    const passwordInput = await screen.findByPlaceholderText("Password");
    await user.type(passwordInput, "sweettreat123");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/"));
  });

  it("logs in as Mom end to end", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    const momButton = await screen.findByText("Mom");
    await user.click(momButton);
    await user.type(await screen.findByPlaceholderText("Password"), "flowerpower1");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/"));
  });

  it("logs in as Sister end to end", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    const sisterButton = await screen.findByText("Sister");
    await user.click(sisterButton);
    await user.type(await screen.findByPlaceholderText("Password"), "carrotcrunch");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/"));
  });

  it("shows an error and does not navigate on wrong password", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    const candyButton = await screen.findByText("Candy");
    await user.click(candyButton);
    await user.type(await screen.findByPlaceholderText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(await screen.findByText(/incorrect password/i)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
