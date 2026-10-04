"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * New pages open at the very top. The App Router keeps the old scroll
 * offset when the layout stays mounted and the new page is taller, so
 * a movie opened from halfway down a list loaded halfway down too.
 * Back/forward are left alone so the browser can restore its position.
 */
export default function ScrollToTop() {
  const pathname = usePathname();
  const poppedRef = useRef(false);
  const firstRef = useRef(true);

  useEffect(() => {
    const onPop = () => {
      poppedRef.current = true;
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (firstRef.current) {
      firstRef.current = false;
      return;
    }
    if (poppedRef.current) {
      poppedRef.current = false;
      return;
    }
    window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
  }, [pathname]);

  return null;
}
