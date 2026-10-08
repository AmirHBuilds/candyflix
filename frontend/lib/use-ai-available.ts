import { useEffect, useState } from "react";
import { getAIStatus } from "@/lib/ai";

// One status lookup shared by everything that asks "may this person use Ask AI?" (the header link, the search
// box, the search page), kept for half a minute so they don't each make a request.
let cached: { at: number; promise: Promise<boolean> } | null = null;
export function resetAIAvailabilityCache() {
  cached = null;
}
function availability(): Promise<boolean> {
  if (!cached || Date.now() - cached.at > 30_000) {
    cached = { at: Date.now(), promise: getAIStatus().then((s) => !!s && s.enabled && (s.limit === null || s.limit > 0)) };
  }
  return cached.promise;
}

/** True once the server has Ask AI set up and this person may use it. `when` = don't even ask until then. */
export function useAIAvailable(when = true): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!when) return;
    let alive = true;
    availability().then((a) => alive && setAvailable(a));
    return () => {
      alive = false;
    };
  }, [when]);
  return available;
}
