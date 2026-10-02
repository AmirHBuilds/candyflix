import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

import Toaster from "@/components/Toaster";
import { clearAllToasts, dismissToast, getToasts, showToast } from "@/lib/toast";

beforeEach(() => {
  vi.useFakeTimers();
  clearAllToasts();
});
afterEach(() => {
  clearAllToasts();
  vi.useRealTimers();
});

describe("toast store", () => {
  it("adds a toast and removes it automatically after the duration", () => {
    showToast("Hello", "info", 3000);
    expect(getToasts().map((t) => t.message)).toEqual(["Hello"]);

    vi.advanceTimersByTime(2999);
    expect(getToasts()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(getToasts()).toHaveLength(0);
  });

  it("defaults to an error toast that stays ~4.5s", () => {
    showToast("Oops");
    expect(getToasts()[0].kind).toBe("error");
    vi.advanceTimersByTime(4499);
    expect(getToasts()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(getToasts()).toHaveLength(0);
  });

  it("showing the same message again restarts its timer instead of stacking a duplicate", () => {
    const a = showToast("Same", "error", 3000);
    vi.advanceTimersByTime(2000);
    const b = showToast("Same", "error", 3000);

    expect(b).toBe(a);
    expect(getToasts()).toHaveLength(1);
    vi.advanceTimersByTime(2000); // 4s after the first call, 2s after the second
    expect(getToasts()).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(getToasts()).toHaveLength(0);
  });

  it("keeps at most three, dropping the oldest — and the dropped one leaves no timer", () => {
    showToast("one");
    showToast("two");
    showToast("three");
    showToast("four");
    expect(getToasts().map((t) => t.message)).toEqual(["two", "three", "four"]);
    expect(vi.getTimerCount()).toBe(3);
  });

  it("can be dismissed early, which also cancels its timer", () => {
    const id = showToast("bye");
    dismissToast(id);
    expect(getToasts()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    dismissToast(id); // harmless the second time
  });

  it("hands out a new array only when something changes (needed by useSyncExternalStore)", () => {
    const before = getToasts();
    expect(getToasts()).toBe(before);
    showToast("x");
    expect(getToasts()).not.toBe(before);
  });
});

describe("<Toaster />", () => {
  it("renders nothing visible when there are no toasts, but keeps its notifications region", () => {
    render(<Toaster />);
    expect(screen.getByRole("region", { name: "Notifications" })).toBeEmptyDOMElement();
  });

  it("shows toasts as they appear, errors as alerts and others as status messages", () => {
    render(<Toaster />);

    act(() => void showToast("Couldn't save", "error"));
    act(() => void showToast("Saved", "success"));

    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't save");
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });

  it("the ✕ button dismisses a toast", () => {
    render(<Toaster />);
    act(() => void showToast("Dismiss me"));

    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));

    expect(screen.queryByText("Dismiss me")).not.toBeInTheDocument();
  });

  it("removes a toast from the screen when its time is up", () => {
    render(<Toaster />);
    act(() => void showToast("Fleeting", "info", 1000));
    expect(screen.getByText("Fleeting")).toBeInTheDocument();

    act(() => void vi.advanceTimersByTime(1000));

    expect(screen.queryByText("Fleeting")).not.toBeInTheDocument();
  });

  it("lets taps pass through everywhere except on a toast, and clears the iPhone home indicator", () => {
    render(<Toaster />);
    const region = screen.getByRole("region", { name: "Notifications" });
    expect(region).toHaveClass("pointer-events-none");
    expect(region.className).toContain("env(safe-area-inset-bottom)");
    act(() => void showToast("x"));
    expect(screen.getByRole("alert")).toHaveClass("pointer-events-auto");
  });
});
