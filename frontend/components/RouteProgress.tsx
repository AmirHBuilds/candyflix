"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

const START_EVENT = "candyflix:progress-start";

/** For code that navigates with router.push: show the bar from the moment of the click. */
export function startProgress(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(START_EVENT));
}

/** Where a click on an in-app link would take us, or null if it isn't a plain same-site navigation. */
export function internalTarget(a: HTMLAnchorElement, e: MouseEvent): string | null {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  if ((a.target && a.target !== "_self") || a.hasAttribute("download")) return null;
  let url: URL;
  try {
    url = new URL(a.href, window.location.href);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  if (url.pathname === window.location.pathname && url.search === window.location.search) return null; // same page, or just a #hash
  return url.pathname + url.search;
}

/**
 * A thin bar along the top of the page while something is loading after a click: opening a title from
 * search, the detail page, a season... anything a skeleton doesn't already cover. It appears only if the
 * wait lasts more than a moment (so quick pages don't flash it), creeps forward while waiting, and
 * finishes when the address changes. Themed with the accent colours.
 */
export default function RouteProgress() {
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? "";
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const active = useRef(false);
  const timers = useRef<{ delay?: ReturnType<typeof setTimeout>; trickle?: ReturnType<typeof setInterval>; safety?: ReturnType<typeof setTimeout>; hide?: ReturnType<typeof setTimeout> }>({});

  const clearTimers = () => {
    const t = timers.current;
    clearTimeout(t.delay);
    clearInterval(t.trickle);
    clearTimeout(t.safety);
  };

  const done = useCallback(() => {
    if (!active.current) return;
    active.current = false;
    clearTimers();
    setWidth(100);
    clearTimeout(timers.current.hide);
    timers.current.hide = setTimeout(() => {
      setVisible(false);
      setWidth(0);
    }, 260);
  }, []);

  const start = useCallback(() => {
    if (active.current) return;
    active.current = true;
    clearTimeout(timers.current.hide);
    timers.current.delay = setTimeout(() => {
      setVisible(true);
      setWidth(10);
      timers.current.trickle = setInterval(() => setWidth((w) => w + (90 - w) * 0.07), 220);
    }, 150);
    timers.current.safety = setTimeout(done, 20_000); // never leave it hanging
  }, [done]);

  // The address changed: the new page is here.
  useEffect(() => {
    done();
  }, [pathname, search, done]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (a && internalTarget(a, e)) start();
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener(START_EVENT, start);
    window.addEventListener("popstate", start);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener(START_EVENT, start);
      window.removeEventListener("popstate", start);
      clearTimers();
      clearTimeout(timers.current.hide);
    };
  }, [start]);

  return (
    <div
      aria-hidden="true"
      data-testid="route-progress"
      data-active={visible}
      className="pointer-events-none fixed inset-x-0 top-0 z-[300] h-[3px] transition-opacity duration-200"
      style={{ opacity: visible ? 1 : 0 }}
    >
      <div
        className="h-full rounded-r-full bg-gradient-to-r from-accent via-secondary to-highlight shadow-[0_0_10px_var(--color-accent)] motion-safe:transition-[width] motion-safe:duration-200 motion-safe:ease-out"
        style={{ width: `${width}%` }}
      />
    </div>
  );
}
