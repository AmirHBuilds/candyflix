"use client";

import { flushWatchProgressAndNavigate } from "@/lib/playback";
import type { WatchIdentity } from "@/components/player/useWatchProgress";

/**
 * Same fix as SeasonBrowser's episode links and VideoPlayer's
 * next/prev/"Up next" controls: leaving the watch page via a plain
 * navigating `<a>` doesn't wait for the last save to land, so the
 * detail page you land on could read a stale resume point. Flushing
 * first, then navigating, closes that race here too.
 */
export default function BackToDetailsLink({
  identity,
  href,
  className,
  children,
}: {
  identity: WatchIdentity;
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        void flushWatchProgressAndNavigate(identity, href);
      }}
      className={className}
    >
      {children}
    </a>
  );
}
