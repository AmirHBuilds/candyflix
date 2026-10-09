import { useEffect, useState } from "react";
import { getWatchAIStatus } from "@/lib/watch-ai";
import type { AIStatus } from "@/lib/ai";

// One status lookup for the player, kept for half a minute (it is read when a video opens).
let cached: { at: number; promise: Promise<AIStatus | null> } | null = null;
export function resetWatchAIStatusCache() {
  cached = null;
}
function lookup(): Promise<AIStatus | null> {
  if (!cached || Date.now() - cached.at > 30_000) cached = { at: Date.now(), promise: getWatchAIStatus() };
  return cached.promise;
}

/** The assistant's status once known (null until then, or if the server has none). `when` = don't ask until then. */
export function useWatchAIStatus(when = true): AIStatus | null {
  const [status, setStatus] = useState<AIStatus | null>(null);
  useEffect(() => {
    if (!when) return;
    let alive = true;
    lookup().then((s) => alive && setStatus(s));
    return () => {
      alive = false;
    };
  }, [when]);
  return status;
}

export function assistantAvailable(s: AIStatus | null): boolean {
  return !!s && s.enabled && (s.limit === null || s.limit > 0);
}
