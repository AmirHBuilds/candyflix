/**
 * Parses SRT and VTT subtitle text into a flat cue list, entirely in
 * JS. We deliberately don't use the browser's native <track> element
 * or TextTrack API: native subtitle rendering can't give the level of
 * customization (font, color, outline, background opacity, position)
 * a real player needs, and mixing formats would otherwise require
 * converting SRT to VTT first. Parsing both directly ourselves avoids
 * that conversion step entirely and gives us full control over
 * rendering (see SubtitleOverlay).
 */

export type Cue = {
  start: number; // seconds
  end: number; // seconds
  text: string;
};

/** Accepts "HH:MM:SS,mmm" (SRT), "HH:MM:SS.mmm" (VTT), or the
 * hours-omitted "MM:SS.mmm" form VTT also allows. */
function timeToSeconds(raw: string): number {
  const normalized = raw.trim().replace(",", ".");
  const parts = normalized.split(":").map((p) => parseFloat(p));

  if (parts.some((p) => Number.isNaN(p))) return 0;

  if (parts.length === 3) {
    const [h, m, s] = parts;
    return h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    const [m, s] = parts;
    return m * 60 + s;
  }
  return parts[0] ?? 0;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", lrm: "", rlm: "" };

/** Lines that are advertising / credits added by subtitle sites, not dialogue. */
const WATERMARK_RE = /opensubtitles|subscene|addic7ed|yts\.|yify|advertise your product|become vip member|support us and become|subtitles? (?:by|downloaded from)|www\.[a-z0-9-]+\.(?:com|org|net)/i;

/**
 * Subtitle text as it should be shown: no <i>, <b>, <font ...> or other markup, no {\an8} / {\i1} style codes,
 * HTML entities turned into characters, and no stray blank lines.
 */
export function cleanCueText(raw: string): string {
  return raw
    .replace(/<\/?[a-zA-Z][^>]*>/g, "")
    .replace(/\{\\[^}]*\}/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

const TIME_RANGE_RE = /([\d:.,]+)\s*-->\s*([\d:.,]+)/;

export function parseSubtitles(raw: string): Cue[] {
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = normalized
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  const cues: Cue[] = [];

  for (const block of blocks) {
    const lines = block.split("\n");
    const timeLineIndex = lines.findIndex((l) => TIME_RANGE_RE.test(l));
    if (timeLineIndex === -1) continue; // e.g. the lone "WEBVTT" header block

    const match = lines[timeLineIndex].match(TIME_RANGE_RE);
    if (!match) continue;

    const start = timeToSeconds(match[1]);
    const end = timeToSeconds(match[2]);
    const text = cleanCueText(lines.slice(timeLineIndex + 1).join("\n"));
    if (WATERMARK_RE.test(text)) continue;

    if (text && end > start) {
      cues.push({ start, end, text });
    }
  }

  return cues.sort((a, b) => a.start - b.start);
}

/** Finds the cue active at the given time, applying a timing offset
 * (positive = subtitles appear later). Returns null if none active. */
export function findActiveCue(cues: Cue[], currentTime: number, offsetSeconds = 0): Cue | null {
  const adjusted = currentTime - offsetSeconds;
  return cues.find((c) => adjusted >= c.start && adjusted <= c.end) ?? null;
}
