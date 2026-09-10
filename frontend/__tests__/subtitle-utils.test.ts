import { describe, it, expect } from "vitest";
import { parseSubtitles, findActiveCue } from "@/components/player/subtitle-utils";

describe("parseSubtitles — SRT format", () => {
  it("parses a basic multi-cue SRT file", () => {
    const srt = `1
00:00:01,000 --> 00:00:04,000
Hello world

2
00:00:05,500 --> 00:00:07,250
Second line
with two rows
`;
    const cues = parseSubtitles(srt);

    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ start: 1, end: 4, text: "Hello world" });
    expect(cues[1].start).toBeCloseTo(5.5);
    expect(cues[1].end).toBeCloseTo(7.25);
    expect(cues[1].text).toBe("Second line\nwith two rows");
  });

  it("handles hour-inclusive timestamps", () => {
    const srt = `1
01:02:03,000 --> 01:02:05,000
Late scene
`;
    const cues = parseSubtitles(srt);
    expect(cues[0].start).toBe(3723);
    expect(cues[0].end).toBe(3725);
  });
});

describe("parseSubtitles — VTT format", () => {
  it("parses a basic VTT file, skipping the WEBVTT header", () => {
    const vtt = `WEBVTT

1
00:00:01.000 --> 00:00:04.000
Hello world

00:00:05.000 --> 00:00:07.000
Cue with no numeric id
`;
    const cues = parseSubtitles(vtt);

    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ start: 1, end: 4, text: "Hello world" });
    expect(cues[1].text).toBe("Cue with no numeric id");
  });

  it("handles VTT's hours-omitted MM:SS.mmm form", () => {
    const vtt = `WEBVTT

00:01.000 --> 00:03.500
Short form timestamp
`;
    const cues = parseSubtitles(vtt);
    expect(cues[0].start).toBe(1);
    expect(cues[0].end).toBe(3.5);
  });
});

describe("parseSubtitles — robustness", () => {
  it("returns an empty array for empty/garbage input", () => {
    expect(parseSubtitles("")).toEqual([]);
    expect(parseSubtitles("not a subtitle file at all")).toEqual([]);
  });

  it("skips a cue with no text", () => {
    const srt = `1
00:00:01,000 --> 00:00:02,000

2
00:00:03,000 --> 00:00:04,000
Real cue
`;
    const cues = parseSubtitles(srt);
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe("Real cue");
  });

  it("skips a cue where end <= start (malformed timing)", () => {
    const srt = `1
00:00:05,000 --> 00:00:02,000
Backwards timing
`;
    expect(parseSubtitles(srt)).toEqual([]);
  });

  it("sorts cues by start time even if the file lists them out of order", () => {
    const srt = `1
00:00:10,000 --> 00:00:12,000
Second

2
00:00:01,000 --> 00:00:02,000
First
`;
    const cues = parseSubtitles(srt);
    expect(cues.map((c) => c.text)).toEqual(["First", "Second"]);
  });

  it("normalizes CRLF line endings", () => {
    const srt = "1\r\n00:00:01,000 --> 00:00:02,000\r\nWindows line endings\r\n";
    const cues = parseSubtitles(srt);
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe("Windows line endings");
  });
});

describe("findActiveCue", () => {
  const cues = [
    { start: 1, end: 3, text: "First" },
    { start: 5, end: 7, text: "Second" },
  ];

  it("returns the cue active at the given time", () => {
    expect(findActiveCue(cues, 2)).toEqual(cues[0]);
    expect(findActiveCue(cues, 6)).toEqual(cues[1]);
  });

  it("returns null when no cue is active", () => {
    expect(findActiveCue(cues, 4)).toBeNull();
    expect(findActiveCue(cues, 100)).toBeNull();
  });

  it("applies a positive offset (subtitles appear later)", () => {
    // Without offset, cue 1 is active at t=2. With +2s offset, it
    // should now be active at t=4 instead (shifted later).
    expect(findActiveCue(cues, 4, 2)).toEqual(cues[0]);
    expect(findActiveCue(cues, 2, 2)).toBeNull();
  });

  it("applies a negative offset (subtitles appear earlier)", () => {
    expect(findActiveCue(cues, 0, -1)).toEqual(cues[0]);
  });
});
