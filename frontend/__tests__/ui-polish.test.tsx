import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { FooterView } from "@/components/Footer";
import RouteProgress, { internalTarget, startProgress } from "@/components/RouteProgress";
import { DEFAULT_FOOTER, LOVE_NOTE } from "@/lib/site";

let path = "/";
vi.mock("next/navigation", () => ({ usePathname: () => path, useSearchParams: () => new URLSearchParams() }));

describe("love note", () => {
  it("is fixed text and shows even when the admin switches the footer off", () => {
    expect(LOVE_NOTE).toBe("Made with all my love, for Candy 💗");
    const { unmount } = render(<FooterView footer={{ ...DEFAULT_FOOTER, enabled: false }} year={2026} />);
    expect(screen.getByText(LOVE_NOTE)).toBeInTheDocument();
    unmount();
    render(<FooterView footer={DEFAULT_FOOTER} year={2026} />);
    expect(screen.getByText(LOVE_NOTE)).toBeInTheDocument();
  });
});

describe("route progress bar", () => {
  it("only appears after a short wait and finishes when the address changes", () => {
    vi.useFakeTimers();
    const { rerender } = render(<RouteProgress />);
    const bar = screen.getByTestId("route-progress");
    expect(bar).toHaveAttribute("data-active", "false");
    act(() => startProgress());
    act(() => void vi.advanceTimersByTime(60));
    expect(bar).toHaveAttribute("data-active", "false"); // quick pages never flash it
    act(() => void vi.advanceTimersByTime(300));
    expect(bar).toHaveAttribute("data-active", "true");
    path = "/title/1";
    rerender(<RouteProgress />);
    act(() => void vi.advanceTimersByTime(400));
    expect(bar).toHaveAttribute("data-active", "false");
    vi.useRealTimers();
  });

  it("starts for plain in-app links, not for new tabs, modified clicks, other sites or the same page", () => {
    const link = (href: string, extra: Partial<HTMLAnchorElement> = {}) => Object.assign(document.createElement("a"), { href, ...extra });
    const click = (init: MouseEventInit = {}) => new MouseEvent("click", { button: 0, ...init });
    expect(internalTarget(link("/search?q=a"), click())).toBe("/search?q=a");
    expect(internalTarget(link("/x", { target: "_blank" }), click())).toBeNull();
    expect(internalTarget(link("/x"), click({ ctrlKey: true }))).toBeNull();
    expect(internalTarget(link("https://elsewhere.example/x"), click())).toBeNull();
    expect(internalTarget(link(window.location.pathname + window.location.search + "#top"), click())).toBeNull();
    fireEvent.click(document.body);
  });
});
