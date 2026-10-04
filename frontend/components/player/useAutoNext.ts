"use client";

import { useEffect, useState } from "react";

export const AUTO_NEXT_SECONDS = 5;

/**
 * The "Up next — playing in 5…" countdown. While `active` it ticks once a
 * second and calls `onGo` when it reaches zero; when `active` turns false
 * (cancelled, video restarted, someone seeked back) it resets, so the next
 * time starts from the full count again. `onGo` fires at most once per
 * activation.
 */
export function useAutoNext(active: boolean, onGo: () => void, seconds = AUTO_NEXT_SECONDS): number {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    if (!active) {
      setRemaining(seconds);
      return;
    }
    setRemaining(seconds);
    let left = seconds;
    const timer = setInterval(() => {
      left -= 1;
      setRemaining(left);
      if (left <= 0) {
        clearInterval(timer);
        onGo();
      }
    }, 1000);
    return () => clearInterval(timer);
    // onGo is read through the closure of this activation only; changing it
    // mid-countdown must not restart the count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, seconds]);

  return remaining;
}
