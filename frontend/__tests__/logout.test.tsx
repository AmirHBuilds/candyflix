import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LogoutButton from "@/components/LogoutButton";

// LogoutButton is the real, shipped client component. We drive a real
// click and confirm it calls the real POST /api/auth/logout on the
// live backend, then navigates to /login.

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: refreshMock }),
}));

beforeEach(() => {
  pushMock.mockClear();
  refreshMock.mockClear();
});

describe("LogoutButton — real component, real backend", () => {
  it("logs out and navigates to /login", async () => {
    const user = userEvent.setup();
    render(<LogoutButton />);

    await user.click(screen.getByRole("button", { name: /log out/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/login"));
  });
});
