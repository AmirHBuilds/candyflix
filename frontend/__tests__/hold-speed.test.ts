import { describe, it, expect } from "vitest";
import { formatHoldRate, holdRateFromPosition, holdRateToGauge } from "@/components/player/hold-speed";

describe("holdRateFromPosition (hold started in the middle of a 1000px player)", () => {
  it.each([
    [500, 2], // where the hold began = 2x
    [1000, 4], // rightmost spot = 4x
    [0, 0.5], // leftmost spot = 0.5x
    [750, 3], // halfway to the right edge
    [250, 1.3], // halfway to the left edge: 1.25, rounded to 0.1
  ])("x=%d → %sx", (x, expected) => {
    expect(holdRateFromPosition(x, 500, 1000)).toBe(expected);
  });

  it("is monotonic: further right is never slower", () => {
    let prev = 0;
    for (let x = 0; x <= 1000; x += 10) {
      const r = holdRateFromPosition(x, 500, 1000);
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
  });

  it("never leaves 0.5x–4x, even for pointers outside the player", () => {
    expect(holdRateFromPosition(-300, 500, 1000)).toBe(0.5);
    expect(holdRateFromPosition(5000, 500, 1000)).toBe(4);
  });
});

describe("holdRateFromPosition (hold started off-centre)", () => {
  it("still begins at 2x wherever the finger lands", () => {
    expect(holdRateFromPosition(200, 200, 1000)).toBe(2);
    expect(holdRateFromPosition(900, 900, 1000)).toBe(2);
  });

  it("still reaches 4x at the right edge and 0.5x at the left edge", () => {
    expect(holdRateFromPosition(1000, 200, 1000)).toBe(4);
    expect(holdRateFromPosition(0, 200, 1000)).toBe(0.5);
    expect(holdRateFromPosition(600, 200, 1000)).toBe(3); // halfway between start and edge
  });

  it("copes with a hold that begins right on an edge (no room to slide that way)", () => {
    expect(holdRateFromPosition(1000, 1000, 1000)).toBe(2);
    expect(holdRateFromPosition(0, 0, 1000)).toBe(2);
    expect(holdRateFromPosition(500, 1000, 1000)).toBe(1.3); // sliding left still slows
  });

  it("falls back to 2x for a zero-width player", () => {
    expect(holdRateFromPosition(10, 10, 0)).toBe(2);
  });
});

describe("holdRateToGauge / formatHoldRate", () => {
  it("puts 0.5x / 2x / 4x at left / centre / right of the gauge", () => {
    expect(holdRateToGauge(0.5)).toBe(0);
    expect(holdRateToGauge(2)).toBe(0.5);
    expect(holdRateToGauge(4)).toBe(1);
    expect(holdRateToGauge(1.25)).toBe(0.25);
    expect(holdRateToGauge(3)).toBe(0.75);
  });

  it("formats compactly", () => {
    expect(formatHoldRate(2)).toBe("2×");
    expect(formatHoldRate(2.3)).toBe("2.3×");
    expect(formatHoldRate(0.5)).toBe("0.5×");
  });
});
