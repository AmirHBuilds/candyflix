import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { boxNameFor } from "@/lib/box-name";
import { BoxNameProvider, useBoxName } from "@/components/BoxNameProvider";

function Show() {
  return <p>{useBoxName()}</p>;
}

describe("box naming", () => {
  it("uses the first name", () => {
    expect(boxNameFor("Amir")).toBe("Amir Box");
    expect(boxNameFor("  Amir Najafi ")).toBe("Amir Box");
  });
  it("falls back to Candy Box without a name", () => {
    expect(boxNameFor("")).toBe("Candy Box");
    expect(boxNameFor(undefined)).toBe("Candy Box");
  });
  it("provides the name to children, and Candy Box without a provider", () => {
    const { unmount } = render(<BoxNameProvider displayName="Sara Ahmadi"><Show /></BoxNameProvider>);
    expect(screen.getByText("Sara Box")).toBeTruthy();
    unmount();
    render(<Show />);
    expect(screen.getByText("Candy Box")).toBeTruthy();
  });
});
