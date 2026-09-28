"use client";

import { navigateWithResumeHint } from "@/lib/playback";
import type { WatchIdentity } from "@/components/player/useWatchProgress";

/**
 * Same non-blocking approach as SeasonBrowser's episode links and
 * VideoPlayer's next/prev/"Up next" controls — see
 * navigateWithResumeHint's docstring in lib/playback.ts. Saves in the
 * background and passes what was playing forward as a URL hint, so
 * leaving the player doesn't make the detail page wait on a save
 * that's still in flight.
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
        navigateWithResumeHint(identity, href);
      }}
      className={className}
    >
      {children}
    </a>
  );
}
