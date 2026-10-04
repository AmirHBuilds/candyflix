/** Skippable parts of a video (Phase 9f). Times are seconds. */

export type SegmentKind = "intro" | "recap" | "credits";
export type SkipSegment = { start: number; end: number; source: "skipdb" | "introdb" };
export type SegmentsData = { intro: SkipSegment | null; recap: SkipSegment | null; credits: SkipSegment | null };

export const SKIP_LABELS: Record<SegmentKind, string> = {
  intro: "Skip Intro",
  recap: "Skip Recap",
  credits: "Skip Credits",
};

// The button stays up until this close to the end of the part, so it never
// flashes for the last instant of it.
const END_MARGIN = 1;
const KINDS: SegmentKind[] = ["intro", "recap", "credits"];

export type SkipButtons = { intro: boolean; recap: boolean; credits: boolean };

/**
 * The part of the video playing right now that has a skip button, if any.
 * A kind switched off in Settings never shows one. If parts overlap, the
 * order intro → recap → credits decides.
 */
export function activeSkip(
  segments: SegmentsData | null,
  time: number,
  buttons: SkipButtons
): { kind: SegmentKind; end: number } | null {
  if (!segments) return null;
  for (const kind of KINDS) {
    const s = segments[kind];
    if (s && buttons[kind] && time >= s.start && time < s.end - END_MARGIN) return { kind, end: s.end };
  }
  return null;
}

/**
 * Where auto-skip should jump to, or null. It only ever acts on the intro,
 * and `alreadyDone` (kept by the caller for the life of this video) makes
 * it fire once, so rewinding into the intro afterwards is left alone.
 */
export function autoSkipTarget(
  segments: SegmentsData | null,
  time: number,
  enabled: boolean,
  alreadyDone: boolean
): number | null {
  if (!enabled || alreadyDone || !segments?.intro) return null;
  const { start, end } = segments.intro;
  return time >= start && time < end - END_MARGIN ? end : null;
}
