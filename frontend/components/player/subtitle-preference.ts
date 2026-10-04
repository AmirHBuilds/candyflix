import type { Settings } from "@/lib/settings";

/** What the player should do about captions when a video opens. */
export type InitialSubtitle =
  | { kind: "off" }
  | { kind: "languages"; languages: string[] };

/**
 * Decides the starting captions, most specific first:
 *
 * 1. This video's own saved choice (only when "Remember settings per
 *    video" is on). "off" means the person turned captions off here.
 * 2. "Auto subtitles" from Settings: the preferred language, then the
 *    fallback if the preferred one can't be found for this title.
 * 3. Otherwise captions start off. A language picked in the player is
 *    never carried to other videos; it belongs to this video alone.
 */
export function resolveInitialSubtitle(args: {
  perVideo: string | undefined;
  rememberPerVideo: boolean;
  auto: Settings["playback"]["auto_subtitles"];
}): InitialSubtitle {
  const { perVideo, rememberPerVideo, auto } = args;
  if (rememberPerVideo && perVideo !== undefined) {
    return perVideo === "off" ? { kind: "off" } : { kind: "languages", languages: [perVideo] };
  }
  if (auto.enabled) {
    const languages = [auto.language, auto.fallback_language].filter((l): l is string => !!l);
    return { kind: "languages", languages: [...new Set(languages)] };
  }
  return { kind: "off" };
}
