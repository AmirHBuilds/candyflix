"use client";

import { useEffect, useState } from "react";

// A precise pointer + hover capability + a reasonably wide viewport is
// the best available proxy for "a desktop/laptop with a keyboard" — phones
// and tablets report a coarse pointer and no hover, so shortcut hints
// (which would just be noise there) stay hidden.
const QUERY = "(hover: hover) and (pointer: fine) and (min-width: 768px)";

/**
 * True on a large-screen, hover-capable device. Starts false so the
 * server render and the client's first render agree (no hydration
 * mismatch), then updates after mount and whenever the window changes.
 */
export function useDesktopKeyboard(): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(QUERY);
    setMatches(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return matches;
}
