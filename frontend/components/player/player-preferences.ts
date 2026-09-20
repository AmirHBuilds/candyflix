/**
 * Player preferences that should carry over between videos and
 * sessions — as opposed to per-video state (playback position, which
 * episode you're on) or subtitle *styling* (font/size/color — see
 * subtitle-settings.ts, already persisted separately).
 *
 * subtitleLanguage is the last language actually selected, `null`
 * meaning "captions were off". It's intentionally global rather than
 * per-title: the expectation (matching most players) is "remember how
 * I like to watch," not "remember what I did for this specific show."
 * If a persisted language isn't available on a given title, the player
 * just leaves captions off for it rather than forcing a mismatched
 * language — see VideoPlayer.tsx's initial state.
 */
export type PlayerPreferences = {
  volume: number; // 0-1
  muted: boolean;
  subtitleLanguage: string | null;
};

export const DEFAULT_PLAYER_PREFERENCES: PlayerPreferences = {
  volume: 1,
  muted: false,
  subtitleLanguage: null,
};

const STORAGE_KEY = "candyflix:player-preferences";

export function loadPlayerPreferences(): PlayerPreferences {
  if (typeof window === "undefined") return DEFAULT_PLAYER_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PLAYER_PREFERENCES;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_PLAYER_PREFERENCES, ...parsed };
  } catch {
    return DEFAULT_PLAYER_PREFERENCES;
  }
}

export function savePlayerPreferences(prefs: PlayerPreferences): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage full/unavailable — preferences just won't persist this time.
  }
}
