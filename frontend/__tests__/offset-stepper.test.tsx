import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";

import OffsetStepper from "@/components/player/OffsetStepper";

// Holds the value like the settings panel does, so tests can watch it change.
function Harness({ initial = 0, spy }: { initial?: number; spy?: (v: number) => void }) {
  const [v, setV] = useState(initial);
  return (
    <OffsetStepper
      value={v}
      onChange={(n) => {
        spy?.(n);
        setV(n);
      }}
    />
  );
}

const later = () => screen.getByRole("button", { name: "Subtitles 100 milliseconds later" });
const earlier = () => screen.getByRole("button", { name: "Subtitles 100 milliseconds earlier" });
const valueButton = () => screen.getByRole("button", { name: "Edit timing offset" });

describe("OffsetStepper — buttons", () => {
  it("shows the value as signed seconds with the unit", () => {
    render(<Harness initial={-2.3} />);
    expect(valueButton()).toHaveTextContent("-2.3");
    expect(valueButton()).toHaveTextContent("S");
  });

  it("> adds 100 ms and < subtracts 100 ms per click", () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    fireEvent.click(later());
    fireEvent.click(later());
    expect(spy).toHaveBeenLastCalledWith(0.2);
    fireEvent.click(earlier());
    fireEvent.click(earlier());
    fireEvent.click(earlier());
    expect(spy).toHaveBeenLastCalledWith(-0.1);
    expect(valueButton()).toHaveTextContent("-0.1");
  });

  it("has no limit: keeps stepping past ±10 s, and no slider is rendered", () => {
    render(<Harness initial={10} />);
    fireEvent.click(later());
    expect(valueButton()).toHaveTextContent("+10.1");
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });
});

describe("OffsetStepper — click to edit", () => {
  function startEdit() {
    fireEvent.click(valueButton());
    return screen.getByRole("textbox", { name: "Timing offset in seconds" }) as HTMLInputElement;
  }

  it("turns the number into a focused input holding the current value", () => {
    render(<Harness initial={1.25} />);
    const input = startEdit();
    expect(input).toHaveFocus();
    expect(input.value).toBe("1.25");
  });

  it("commits a typed value (seconds) on Enter", () => {
    render(<Harness />);
    const input = startEdit();
    fireEvent.change(input, { target: { value: "-45.5" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(valueButton()).toHaveTextContent("-45.5");
  });

  it("commits on blur", () => {
    render(<Harness />);
    const input = startEdit();
    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.blur(input);
    expect(valueButton()).toHaveTextContent("+2.0");
  });

  it("Escape cancels without changing anything, even if a blur follows", () => {
    const spy = vi.fn();
    render(<Harness initial={1} spy={spy} />);
    const input = startEdit();
    fireEvent.change(input, { target: { value: "99" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input); // some browsers blur the element as it unmounts
    expect(spy).not.toHaveBeenCalled();
    expect(valueButton()).toHaveTextContent("+1.0");
  });

  it("reverts on invalid input instead of changing the offset", () => {
    const spy = vi.fn();
    render(<Harness initial={1} spy={spy} />);
    const input = startEdit();
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(spy).not.toHaveBeenCalled();
    expect(valueButton()).toHaveTextContent("+1.0");
  });

  it("can be edited again after an Escape (the cancel flag doesn't stick)", () => {
    render(<Harness />);
    let input = startEdit();
    fireEvent.keyDown(input, { key: "Escape" });
    input = startEdit();
    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.blur(input);
    expect(valueButton()).toHaveTextContent("+3.0");
  });
});
