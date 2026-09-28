"use client";

import { useEffect } from "react";

/**
 * Purely cosmetic: the ?fromSeason=&fromEpisode= hint (see
 * navigateWithResumeHint in lib/playback.ts) has already done its job
 * once this page's server-side render read it — there's no reason for
 * it to keep sitting in the visible URL bar afterward. replaceState
 * doesn't trigger a navigation or re-render, just tidies the address.
 */
export default function StripResumeHintFromUrl() {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("fromSeason") && !url.searchParams.has("fromEpisode")) return;
    url.searchParams.delete("fromSeason");
    url.searchParams.delete("fromEpisode");
    window.history.replaceState(null, "", url.pathname + url.search);
  }, []);

  return null;
}
