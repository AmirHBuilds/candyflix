import { describe, expect, it } from "vitest";
import { summarizeRelease } from "@/lib/release";

describe("summarizeRelease", () => {
  it.each([
    ["Show.Name.S01E02.1080p.BluRay.x265.10bit-RARBG", "BluRay · 1080p · x265 · 10-bit · RARBG"],
    ["Show Name S01E02 [1080p] WEB-DL H.264", "WEB-DL · 1080p · x264"],
    ["Show_Name_S01E02_720p_HDTV_XviD-LOL", "HDTV · 720p · XviD · LOL"],
    ["Show.Name.S01E02.2160p.WEBRip.HEVC.HDR.srt", "WEBRip · 2160p · x265 · HDR"],
    ["Show.Name.S01E02.UHD.BluRay.REMUX.DV", "Remux · 2160p · Dolby Vision"],
  ])("%s", (input, expected) => expect(summarizeRelease(input)).toBe(expected));

  it("writes dotted, spaced and underscored names the same way", () => {
    const a = summarizeRelease("Movie.2020.1080p.BluRay.x264-GRP");
    expect(summarizeRelease("Movie 2020 1080p BluRay x264-GRP")).toBe(a);
    expect(summarizeRelease("Movie_2020_1080p_BluRay_x264-GRP")).toBe(a);
  });

  it("falls back to a tidy short name, and to nothing for no name", () => {
    expect(summarizeRelease("Some.Odd.Name")).toBe("Some Odd Name");
    expect(summarizeRelease(null)).toBe("");
  });
});
