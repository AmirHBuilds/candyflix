import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useRef } from "react";

import { useHoldSpeed } from "@/components/player/useHoldSpeed";

// jsdom may not ship PointerEvent (RTL would then fall back to a plain
// Event and drop clientX / pointerId).
if (typeof window.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? "mouse";
    }
  }
  // @ts-expect-error test polyfill
  window.PointerEvent = PointerEventPolyfill;
}

type Api = ReturnType<typeof useHoldSpeed>;

function Harness({ api }: { api: { current: Api | null } }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hold = useHoldSpeed(videoRef);
  api.current = hold;
  return (
    <div data-testid="surface" {...hold.surfaceHandlers}>
      <video ref={videoRef} data-testid="video" />
    </div>
  );
}

function setup({ paused = false, rate = 1 } = {}) {
  const api: { current: Api | null } = { current: null };
  render(<Harness api={api} />);
  const surface = screen.getByTestId("surface");
  surface.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 1000, height: 500, right: 1000, bottom: 500, x: 0, y: 0, toJSON() {} }) as DOMRect;
  const video = screen.getByTestId("video") as HTMLVideoElement;
  let currentRate = rate;
  Object.defineProperty(video, "playbackRate", { configurable: true, get: () => currentRate, set: (v) => (currentRate = v) });
  Object.defineProperty(video, "paused", { configurable: true, get: () => paused });
  return { api, surface, video };
}

const down = (el: Element, x = 500, extra: PointerEventInit = {}) =>
  fireEvent.pointerDown(el, { pointerId: 1, pointerType: "touch", button: 0, clientX: x, clientY: 200, ...extra });
const move = (el: Element, x: number, y = 200) =>
  fireEvent.pointerMove(el, { pointerId: 1, pointerType: "touch", clientX: x, clientY: y });
const up = (el: Element) => fireEvent.pointerUp(el, { pointerId: 1, pointerType: "touch" });
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useHoldSpeed — pointer hold", () => {
  it("plays at 2x after holding ~0.5s, and restores the previous rate on release", () => {
    const { api, surface, video } = setup({ rate: 1.25 });
    down(surface);
    wait(499);
    expect(video.playbackRate).toBe(1.25);
    expect(api.current!.holdRate).toBeNull();

    wait(1);
    expect(video.playbackRate).toBe(2);
    expect(api.current!.holdRate).toBe(2);

    up(surface);
    expect(video.playbackRate).toBe(1.25);
    expect(api.current!.holdRate).toBeNull();
  });

  it("sliding right speeds up to 4x at the right edge; sliding left slows to 0.5x at the left edge", () => {
    const { api, surface, video } = setup();
    down(surface, 500);
    wait(500);

    move(surface, 750);
    expect(video.playbackRate).toBe(3);
    move(surface, 1000);
    expect(video.playbackRate).toBe(4);
    expect(api.current!.holdRate).toBe(4);

    move(surface, 250);
    expect(video.playbackRate).toBe(1.3);
    move(surface, 0);
    expect(video.playbackRate).toBe(0.5);

    move(surface, 500);
    expect(video.playbackRate).toBe(2);
  });

  it("a quick tap never changes the speed and never suppresses its click", () => {
    const { api, surface, video } = setup();
    down(surface);
    wait(200);
    up(surface);
    wait(1000);
    expect(video.playbackRate).toBe(1);
    expect(api.current!.consumeSuppressedClick()).toBe(false);
  });

  it("swallows exactly one click after a hold (its release must not toggle play)", () => {
    const { api, surface } = setup();
    down(surface);
    wait(500);
    up(surface);
    expect(api.current!.consumeSuppressedClick()).toBe(true);
    expect(api.current!.consumeSuppressedClick()).toBe(false);
  });

  it("forgets the pending click suppression if no click ever arrives", () => {
    const { api, surface } = setup();
    down(surface);
    wait(500);
    up(surface);
    wait(150);
    expect(api.current!.consumeSuppressedClick()).toBe(false);
  });

  it("moving more than a few px before the delay means it's a drag, not a hold", () => {
    const { api, surface, video } = setup();
    down(surface, 500);
    move(surface, 530);
    wait(600);
    expect(video.playbackRate).toBe(1);
    expect(api.current!.holdRate).toBeNull();
  });

  it("ignores tiny finger jitter", () => {
    const { surface, video } = setup();
    down(surface, 500);
    move(surface, 504);
    wait(500);
    expect(video.playbackRate).toBe(2);
  });

  it("does nothing while the video is paused", () => {
    const { api, surface, video } = setup({ paused: true });
    down(surface);
    wait(800);
    expect(video.playbackRate).toBe(1);
    expect(api.current!.holdRate).toBeNull();
    up(surface);
    expect(api.current!.consumeSuppressedClick()).toBe(false);
  });

  it("ignores the right mouse button and a second finger", () => {
    const { surface, video } = setup();
    down(surface, 500, { pointerType: "mouse", button: 2 });
    wait(800);
    expect(video.playbackRate).toBe(1);

    down(surface, 500, { pointerId: 1 });
    down(surface, 900, { pointerId: 2 });
    wait(500);
    move(surface, 1000); // pointer 1 (the holder) still drives the rate
    expect(video.playbackRate).toBe(4);
    fireEvent.pointerUp(surface, { pointerId: 2, pointerType: "touch" });
    expect(video.playbackRate).toBe(4); // the second finger lifting doesn't end it
  });

  it("works with a mouse too (left button held)", () => {
    const { surface, video } = setup();
    fireEvent.pointerDown(surface, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 500, clientY: 100 });
    wait(500);
    expect(video.playbackRate).toBe(2);
    fireEvent.pointerUp(surface, { pointerId: 1, pointerType: "mouse" });
    expect(video.playbackRate).toBe(1);
  });

  it("pointercancel (e.g. the browser takes over the gesture) also restores the rate", () => {
    const { surface, video } = setup();
    down(surface);
    wait(500);
    fireEvent.pointerCancel(surface, { pointerId: 1, pointerType: "touch" });
    expect(video.playbackRate).toBe(1);
  });

  it("losing window focus mid-hold never leaves the video stuck fast", () => {
    const { api, surface, video } = setup();
    down(surface);
    wait(500);
    act(() => void window.dispatchEvent(new Event("blur")));
    expect(video.playbackRate).toBe(1);
    expect(api.current!.holdRate).toBeNull();
  });
});

describe("useHoldSpeed — Space bar", () => {
  it("holding Space ≥0.5s plays at 2x, and releasing it restores the rate without a 'tap'", () => {
    const { api, video } = setup();
    act(() => api.current!.onSpaceDown());
    wait(500);
    expect(video.playbackRate).toBe(2);
    expect(api.current!.holdRate).toBe(2);

    let result: ReturnType<Api["onSpaceUp"]> = null;
    act(() => {
      result = api.current!.onSpaceUp();
    });
    expect(result).toBe("hold");
    expect(video.playbackRate).toBe(1);
  });

  it("a quick Space press is a 'tap' (toggle play/pause) and never changes speed", () => {
    const { api, video } = setup();
    act(() => api.current!.onSpaceDown());
    wait(200);
    let result: ReturnType<Api["onSpaceUp"]> = null;
    act(() => {
      result = api.current!.onSpaceUp();
    });
    expect(result).toBe("tap");
    wait(1000);
    expect(video.playbackRate).toBe(1);
  });

  it("when paused, even a long Space press stays a 'tap' (so it resumes playback)", () => {
    const { api, video } = setup({ paused: true });
    act(() => api.current!.onSpaceDown());
    wait(800);
    expect(video.playbackRate).toBe(1);
    let result: ReturnType<Api["onSpaceUp"]> = null;
    act(() => {
      result = api.current!.onSpaceUp();
    });
    expect(result).toBe("tap");
  });

  it("repeated keydowns don't restart the timer; a stray keyup does nothing", () => {
    const { api, video } = setup();
    act(() => api.current!.onSpaceDown());
    wait(300);
    act(() => api.current!.onSpaceDown()); // auto-repeat
    wait(200);
    expect(video.playbackRate).toBe(2);

    act(() => void api.current!.onSpaceUp());
    let result: ReturnType<Api["onSpaceUp"]> = "tap";
    act(() => {
      result = api.current!.onSpaceUp();
    });
    expect(result).toBeNull();
  });
});
