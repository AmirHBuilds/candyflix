import { describe, it, expect } from "vitest";
import { activeSkip, autoSkipTarget, type SegmentsData } from "@/components/player/skip-segments";

const seg = (start: number, end: number) => ({ start, end, source: "skipdb" as const });
const data: SegmentsData = { intro: seg(10, 90), recap: seg(0, 8), credits: seg(2400, 2500) };
const all = { intro: true, recap: true, credits: true };

describe("activeSkip", () => {
  it("is null with no data, before, between and after the parts", () => {
    expect(activeSkip(null, 20, all)).toBeNull();
    expect(activeSkip(data, 9, all)).toBeNull();
    expect(activeSkip(data, 100, all)).toBeNull();
    expect(activeSkip(data, 2600, all)).toBeNull();
  });

  it("names the part playing and where it ends", () => {
    expect(activeSkip(data, 10, all)).toEqual({ kind: "intro", end: 90 });
    expect(activeSkip(data, 3, all)).toEqual({ kind: "recap", end: 8 });
    expect(activeSkip(data, 2450, all)).toEqual({ kind: "credits", end: 2500 });
  });

  it("drops the button for the last second of a part", () => {
    expect(activeSkip(data, 88.9, all)).not.toBeNull();
    expect(activeSkip(data, 89.5, all)).toBeNull();
  });

  it("a kind switched off never shows a button", () => {
    expect(activeSkip(data, 20, { ...all, intro: false })).toBeNull();
    expect(activeSkip(data, 3, { ...all, recap: false })).toBeNull();
    expect(activeSkip(data, 2450, { ...all, credits: false })).toBeNull();
  });

  it("handles parts that are missing", () => {
    expect(activeSkip({ intro: null, recap: null, credits: null }, 20, all)).toBeNull();
  });

  it("prefers intro, then recap, when parts overlap", () => {
    const overlap: SegmentsData = { intro: seg(0, 60), recap: seg(0, 30), credits: null };
    expect(activeSkip(overlap, 10, all)?.kind).toBe("intro");
    expect(activeSkip(overlap, 10, { ...all, intro: false })?.kind).toBe("recap");
  });
});

describe("autoSkipTarget", () => {
  it("jumps to the end of the intro when it's inside it", () => {
    expect(autoSkipTarget(data, 12, true, false)).toBe(90);
    expect(autoSkipTarget(data, 10, true, false)).toBe(90);
  });

  it("does nothing when off, outside the intro, with no intro, or already done", () => {
    expect(autoSkipTarget(data, 12, false, false)).toBeNull();
    expect(autoSkipTarget(data, 5, true, false)).toBeNull();
    expect(autoSkipTarget(data, 95, true, false)).toBeNull();
    expect(autoSkipTarget({ ...data, intro: null }, 12, true, false)).toBeNull();
    expect(autoSkipTarget(data, 12, true, true)).toBeNull();
    expect(autoSkipTarget(null, 12, true, false)).toBeNull();
  });

  it("only ever acts on the intro (never recap or credits)", () => {
    expect(autoSkipTarget(data, 3, true, false)).toBeNull();
    expect(autoSkipTarget(data, 2450, true, false)).toBeNull();
  });
});
