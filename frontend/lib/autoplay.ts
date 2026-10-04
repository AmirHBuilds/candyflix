/**
 * A one-shot "start this video playing" note passed from one watch page to
 * the next. Autoplay-next navigates with a full page load, and the new
 * page's player has to know it was reached by autoplay (so it starts
 * playing even if "Start playing when a video opens" is off — the person
 * already chose to keep watching). sessionStorage, so it can't leak into a
 * later visit, and consumed on first read so a refresh doesn't replay.
 */
const KEY = "candyflix:autoplay-next";

export function flagAutoplayNext(): void {
  try {
    window.sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* storage unavailable: the next video just waits for a click */
  }
}

/** True once if the previous page asked for autoplay in the last 30 s. */
export function consumeAutoplayFlag(now = Date.now()): boolean {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw === null) return false;
    window.sessionStorage.removeItem(KEY);
    return now - Number(raw) < 30_000;
  } catch {
    return false;
  }
}
