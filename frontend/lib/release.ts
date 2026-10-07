// Release names arrive in every style: "Show.S01E02.1080p.BluRay.x265-GRP", "Show S01E02 [1080p] WEB-DL h264",
// "Show_S01E02_720p_HDTV_XviD". The show and episode are already known where the list is shown, so this keeps only
// what helps choose a subtitle (the version of the video it was made for) and writes it the same way every time.

const KNOWN_NOT_GROUPS = /^(dl|rip|ray|hd|sd|dts|ddp?\d*|aac\d*|ac3|h|x|web|dvd)$/i;

export function summarizeRelease(release: string | null | undefined): string {
  if (!release) return "";
  const raw = release.trim().replace(/\.(srt|ass|ssa|sub|vtt|mkv|mp4|avi)$/i, "");
  // Same separators everywhere; hyphens stay (WEB-DL, 10-bit, -GROUP).
  const text = raw.replace(/[._\s]+/g, " ").replace(/[[\](){}]/g, " ").replace(/\s+/g, " ").trim();
  const has = (re: RegExp) => re.test(text);

  const parts: string[] = [];

  if (has(/\bremux\b/i)) parts.push("Remux");
  else if (has(/\b(blu ?ray|bd ?rip|br ?rip|bdrip)\b|\bbd\b/i)) parts.push("BluRay");
  else if (has(/\bweb[ -]?dl\b/i)) parts.push("WEB-DL");
  else if (has(/\bweb[ -]?rip\b/i)) parts.push("WEBRip");
  else if (has(/\bweb\b/i)) parts.push("WEB");
  else if (has(/\b(hdtv|pdtv|tvrip)\b/i)) parts.push("HDTV");
  else if (has(/\bdvd ?(rip|scr)?\b/i)) parts.push("DVD");
  else if (has(/\bhd ?rip\b/i)) parts.push("HDRip");
  else if (has(/\b(cam|hdcam|telesync|ts)\b/i)) parts.push("CAM");

  const res = text.match(/\b(2160|1440|1080|720|576|480)[pi]\b/i);
  if (res) parts.push(`${res[1]}p`);
  else if (has(/\b(4k|uhd)\b/i)) parts.push("2160p");

  if (has(/\b(x ?265|h ?\.?265|hevc)\b/i)) parts.push("x265");
  else if (has(/\b(x ?264|h ?\.?264|avc)\b/i)) parts.push("x264");
  else if (has(/\bav1\b/i)) parts.push("AV1");
  else if (has(/\bxvid\b/i)) parts.push("XviD");

  if (has(/\b10 ?-? ?bits?\b/i)) parts.push("10-bit");
  if (has(/\bdolby ?vision\b|\bdv\b/i)) parts.push("Dolby Vision");
  else if (has(/\bhdr(10\+?)?\b/i)) parts.push("HDR");
  if (has(/\b(repack|proper)\b/i)) parts.push("Repack");

  // Group: "-GROUP" at the very end ("...x264-DIMENSION"), or a lone "[GROUP]" at the start (anime style).
  const tail = raw.replace(/[._\s]+/g, " ").trim().match(/-([A-Za-z0-9]{2,})$/);
  const lead = release.trim().match(/^\[([^\]]{2,24})\]/);
  const group = tail && !KNOWN_NOT_GROUPS.test(tail[1]) && !/^\d+[pi]$/i.test(tail[1]) ? tail[1] : lead && !/^\d+[pi]$/i.test(lead[1]) ? lead[1] : null;
  if (group) parts.push(group);

  if (parts.length > 0) return parts.join(" · ");
  // Nothing recognisable: show the name in one tidy line instead of nothing.
  return text.length > 48 ? `${text.slice(0, 47).trimEnd()}…` : text;
}
