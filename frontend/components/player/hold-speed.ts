// Press-and-hold speed control. Hold the video (finger, mouse button, or
// the Space bar) and it plays at 2x; while holding a finger/mouse, sliding
// right speeds it up to 4x at the right edge of the player, sliding left
// slows it to 0.5x at the left edge.
//
// The mapping is anchored where the hold *started* (that spot = 2x)
// rather than absolute across the screen. Both read the same for the
// natural "hold in the middle" case, but anchoring means holding anywhere
// always begins at 2x — an absolute map would lurch to 0.5x or 4x if the
// thumb happened to land near an edge — while the far edges still reach
// exactly 0.5x and 4x whenever there's room to slide.

/** How long a press must last before it counts as a hold, not a tap. */
export const HOLD_DELAY_MS = 500;
/** Movement (px) before the delay ends that means "this is a drag, not a hold". */
export const HOLD_MOVE_TOLERANCE_PX = 10;

export const HOLD_MIN_RATE = 0.5;
export const HOLD_BASE_RATE = 2;
export const HOLD_MAX_RATE = 4;

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

/**
 * Playback rate for a pointer at `x`, given where the hold began
 * (`startX`) and the player's width — all in the same coordinate space
 * (px from the player's left edge). Piecewise linear: startX → 2x,
 * right edge → 4x, left edge → 0.5x. Rounded to 0.1 so the rate (and
 * its on-screen label) doesn't jitter on sub-pixel moves.
 */
export function holdRateFromPosition(x: number, startX: number, width: number): number {
  if (width <= 0) return HOLD_BASE_RATE;
  const start = clamp(startX, 0, width);
  const pos = clamp(x, 0, width);

  let rate: number;
  if (pos >= start) {
    const span = width - start;
    const t = span > 0 ? (pos - start) / span : 0;
    rate = HOLD_BASE_RATE + t * (HOLD_MAX_RATE - HOLD_BASE_RATE);
  } else {
    const t = start > 0 ? (start - pos) / start : 0;
    rate = HOLD_BASE_RATE - t * (HOLD_BASE_RATE - HOLD_MIN_RATE);
  }
  return Math.round(rate * 10) / 10;
}

/** 0..1 position of a rate on the on-screen gauge (0.5x left, 2x centre, 4x right). */
export function holdRateToGauge(rate: number): number {
  const r = clamp(rate, HOLD_MIN_RATE, HOLD_MAX_RATE);
  return r <= HOLD_BASE_RATE
    ? ((r - HOLD_MIN_RATE) / (HOLD_BASE_RATE - HOLD_MIN_RATE)) * 0.5
    : 0.5 + ((r - HOLD_BASE_RATE) / (HOLD_MAX_RATE - HOLD_BASE_RATE)) * 0.5;
}

/** "2×", "2.3×", "0.5×" */
export function formatHoldRate(rate: number): string {
  return `${Number(rate.toFixed(1))}×`;
}
