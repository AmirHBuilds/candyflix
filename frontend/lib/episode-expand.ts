/** "Show all episodes" is remembered per show for a day, so opening the show again doesn't re-collapse a long list. */
const KEY = (tvId: number) => `candyflix:episodes-expanded:${tvId}`;
export const EXPAND_TTL_MS = 24 * 60 * 60 * 1000;
export const EPISODES_SHOWN_BY_DEFAULT = 10;

export function wasExpanded(tvId: number, now = Date.now()): boolean {
  try {
    const at = Number(window.localStorage.getItem(KEY(tvId)));
    if (!at) return false;
    if (now - at > EXPAND_TTL_MS) {
      window.localStorage.removeItem(KEY(tvId));
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function rememberExpanded(tvId: number, now = Date.now()): void {
  try {
    window.localStorage.setItem(KEY(tvId), String(now));
  } catch {
    /* private window or blocked storage: it just won't be remembered */
  }
}
