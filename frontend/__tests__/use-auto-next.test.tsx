import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, render, screen } from "@testing-library/react";
import { useAutoNext } from "@/components/player/useAutoNext";

function Probe({ active, onGo }: { active: boolean; onGo: () => void }) {
  const n = useAutoNext(active, onGo);
  return <p data-testid="n">{n}</p>;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const tick = (s: number) => act(() => void vi.advanceTimersByTime(s * 1000));

describe("useAutoNext", () => {
  it("does nothing while inactive", () => {
    const go = vi.fn();
    render(<Probe active={false} onGo={go} />);
    tick(20);
    expect(go).not.toHaveBeenCalled();
    expect(screen.getByTestId("n")).toHaveTextContent("5");
  });

  it("counts 5, 4, 3, 2, 1 and goes at zero — once", () => {
    const go = vi.fn();
    render(<Probe active onGo={go} />);
    expect(screen.getByTestId("n")).toHaveTextContent("5");
    tick(1);
    expect(screen.getByTestId("n")).toHaveTextContent("4");
    tick(3);
    expect(screen.getByTestId("n")).toHaveTextContent("1");
    expect(go).not.toHaveBeenCalled();
    tick(1);
    expect(go).toHaveBeenCalledTimes(1);
    tick(30);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("cancelling mid-count stops it for good", () => {
    const go = vi.fn();
    const { rerender } = render(<Probe active onGo={go} />);
    tick(3);
    rerender(<Probe active={false} onGo={go} />);
    tick(20);
    expect(go).not.toHaveBeenCalled();
    expect(screen.getByTestId("n")).toHaveTextContent("5"); // reset for next time
  });

  it("starts from the full count again when re-activated", () => {
    const go = vi.fn();
    const { rerender } = render(<Probe active onGo={go} />);
    tick(3);
    rerender(<Probe active={false} onGo={go} />);
    rerender(<Probe active onGo={go} />);
    expect(screen.getByTestId("n")).toHaveTextContent("5");
    tick(4);
    expect(go).not.toHaveBeenCalled();
    tick(1);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("a new onGo callback mid-count doesn't restart the count", () => {
    const first = vi.fn();
    const { rerender } = render(<Probe active onGo={first} />);
    tick(3);
    rerender(<Probe active onGo={vi.fn()} />);
    tick(2);
    expect(first).toHaveBeenCalledTimes(1);
  });
});
