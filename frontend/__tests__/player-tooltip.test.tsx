import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, act } from "@testing-library/react";

import PlayerTooltip from "@/components/player/PlayerTooltip";

function mockMatchMedia(matches: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const mql = {
    matches,
    addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.delete(cb),
  };
  window.matchMedia = vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia;
  return {
    change(next: boolean) {
      act(() => listeners.forEach((cb) => cb({ matches: next } as MediaQueryListEvent)));
    },
    query: () => (window.matchMedia as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string,
  };
}

afterEach(() => {
  // @ts-expect-error reset the jsdom default (matchMedia is absent)
  delete window.matchMedia;
});

const tip = () => screen.getByRole("tooltip", { hidden: true });

describe("PlayerTooltip", () => {
  it("shows the button's name, and keeps the button itself intact", () => {
    mockMatchMedia(true);
    render(
      <PlayerTooltip label="Mute" shortcuts={["M"]}>
        <button aria-label="Mute/unmute">x</button>
      </PlayerTooltip>
    );
    expect(tip()).toHaveTextContent("Mute");
    expect(screen.getByRole("button", { name: "Mute/unmute" })).toBeInTheDocument();
  });

  it("shows shortcut keys on a desktop-class device (precise pointer + hover + wide screen)", () => {
    const mm = mockMatchMedia(true);
    render(
      <PlayerTooltip label="Play" shortcuts={["Space", "K"]}>
        <button>x</button>
      </PlayerTooltip>
    );
    expect(tip()).toHaveTextContent("Play");
    expect(tip()).toHaveTextContent("Space");
    expect(tip()).toHaveTextContent("K");
    expect(mm.query()).toContain("hover: hover");
    expect(mm.query()).toContain("pointer: fine");
    expect(mm.query()).toContain("min-width");
  });

  it("hides shortcuts on phones/tablets but still shows the name", () => {
    mockMatchMedia(false);
    render(
      <PlayerTooltip label="Fullscreen" shortcuts={["F"]}>
        <button>x</button>
      </PlayerTooltip>
    );
    expect(tip()).toHaveTextContent("Fullscreen");
    expect(tip().querySelector("kbd")).toBeNull();
  });

  it("hides shortcuts when matchMedia doesn't exist at all", () => {
    render(
      <PlayerTooltip label="Settings" shortcuts={["S"]}>
        <button>x</button>
      </PlayerTooltip>
    );
    expect(tip().querySelector("kbd")).toBeNull();
  });

  it("reacts when the window starts/stops matching (e.g. resizing)", () => {
    const mm = mockMatchMedia(false);
    render(
      <PlayerTooltip label="Play" shortcuts={["K"]}>
        <button>x</button>
      </PlayerTooltip>
    );
    expect(tip().querySelector("kbd")).toBeNull();
    mm.change(true);
    expect(tip().querySelector("kbd")).not.toBeNull();
    mm.change(false);
    expect(tip().querySelector("kbd")).toBeNull();
  });

  it("renders no tooltip at all when disabled", () => {
    mockMatchMedia(true);
    render(
      <PlayerTooltip label="Settings" shortcuts={["S"]} disabled>
        <button>x</button>
      </PlayerTooltip>
    );
    expect(screen.queryByRole("tooltip", { hidden: true })).not.toBeInTheDocument();
  });

  it("is invisible by default and revealed only via hover/keyboard-focus classes (never plain focus)", () => {
    mockMatchMedia(true);
    render(
      <PlayerTooltip label="Play">
        <button>x</button>
      </PlayerTooltip>
    );
    expect(tip()).toHaveClass("opacity-0", "pointer-events-none");
    expect(tip().className).toContain("group-hover/tip:opacity-100");
    expect(tip().className).toContain("group-has-[:focus-visible]/tip:opacity-100");
    expect(tip().className).not.toContain("focus-within");
  });

  it("anchors to the right edge for buttons at the end of the control bar", () => {
    mockMatchMedia(true);
    render(
      <PlayerTooltip label="Fullscreen" align="end">
        <button>x</button>
      </PlayerTooltip>
    );
    expect(tip()).toHaveClass("right-0");
  });
});
