import { describe, it, expect, vi } from "vitest";
import { findAdjacentEpisodes } from "@/lib/next-episode";
import type { Episode, SeasonDetail, SeasonSummary } from "@/lib/media";

const ep = (n: number, air_date: string | null = "2020-01-01"): Episode => ({
  episode_number: n, name: `E${n}`, overview: "", still_path: null, air_date, runtime_minutes: null,
});
const season = (n: number, episodes: Episode[]): SeasonDetail => ({ tv_id: 1, season_number: n, name: `S${n}`, episodes });
const summary = (n: number, count: number): SeasonSummary => ({ season_number: n, name: `S${n}`, episode_count: count, poster_path: null });

const TODAY = new Date("2026-06-01");

function setup(data: Record<number, Episode[]>) {
  const loadSeason = vi.fn(async (n: number) => season(n, data[n] ?? []));
  const seasons = Object.entries(data).map(([n, eps]) => summary(Number(n), eps.length));
  return { loadSeason, seasons };
}

const run = (data: Record<number, Episode[]>, seasonNumber: number, episodeNumber: number) => {
  const { loadSeason, seasons } = setup(data);
  return findAdjacentEpisodes({ seasons, seasonNumber, episodes: data[seasonNumber], episodeNumber, loadSeason, today: TODAY }).then((r) => ({
    ...r,
    loadSeason,
  }));
};

const label = (r: { season: number; episode: Episode } | null) => (r ? `S${r.season}E${r.episode.episode_number}` : null);

describe("findAdjacentEpisodes", () => {
  it("inside a season, uses the neighbours and makes no extra requests", async () => {
    const r = await run({ 1: [ep(1), ep(2), ep(3)] }, 1, 2);
    expect([label(r.prev), label(r.next)]).toEqual(["S1E1", "S1E3"]);
    expect(r.loadSeason).not.toHaveBeenCalled();
  });

  it("the last episode of a season rolls into the first of the next", async () => {
    const r = await run({ 1: [ep(1), ep(2)], 2: [ep(1), ep(2)] }, 1, 2);
    expect(label(r.next)).toBe("S2E1");
    expect(r.loadSeason).toHaveBeenCalledWith(2);
  });

  it("the first episode of a season rolls back to the last of the previous one", async () => {
    const r = await run({ 1: [ep(1), ep(2), ep(3)], 2: [ep(1)] }, 2, 1);
    expect(label(r.prev)).toBe("S1E3");
    expect(r.next).toBeNull();
  });

  it("the last episode of the last season has no next (autoplay stops)", async () => {
    const r = await run({ 1: [ep(1)], 2: [ep(1), ep(2)] }, 2, 2);
    expect(r.next).toBeNull();
  });

  it("skips empty seasons", async () => {
    const data = { 1: [ep(1)], 2: [], 3: [ep(1)] };
    const { loadSeason } = setup(data);
    const seasons = [summary(1, 1), summary(2, 0), summary(3, 1)];
    const r = await findAdjacentEpisodes({ seasons, seasonNumber: 1, episodes: data[1], episodeNumber: 1, loadSeason, today: TODAY });
    expect(label(r.next)).toBe("S3E1");
    expect(loadSeason).not.toHaveBeenCalledWith(2);
  });

  it("never rolls into or out of the Specials (season 0)", async () => {
    const data = { 0: [ep(1), ep(2)], 1: [ep(1), ep(2)] };
    const a = await run(data, 1, 1);
    expect(a.prev).toBeNull();
    const { loadSeason } = setup(data);
    const b = await findAdjacentEpisodes({ seasons: [summary(0, 2), summary(1, 2)], seasonNumber: 0, episodes: data[0], episodeNumber: 2, loadSeason, today: TODAY });
    expect(label(b.next)).toBe("S1E1"); // from the specials, the story resumes at season 1
  });

  it("does not offer an episode that hasn't aired yet", async () => {
    const r = await run({ 1: [ep(1), ep(2, "2027-01-01")] }, 1, 1);
    expect(r.next).toBeNull();
  });

  it("does not roll into a season that hasn't started airing", async () => {
    const r = await run({ 1: [ep(1)], 2: [ep(1, "2027-01-01")] }, 1, 1);
    expect(r.next).toBeNull();
  });

  it("treats an unknown air date as available", async () => {
    const r = await run({ 1: [ep(1), ep(2, null)] }, 1, 1);
    expect(label(r.next)).toBe("S1E2");
  });

  it("an episode number that isn't in the season gives no next/prev inside it", async () => {
    const r = await run({ 1: [ep(1), ep(2)] }, 1, 99);
    expect(r.next).toBeNull();
  });

  it("episode numbers needn't be contiguous", async () => {
    const r = await run({ 1: [ep(1), ep(3), ep(7)] }, 1, 3);
    expect([label(r.prev), label(r.next)]).toEqual(["S1E1", "S1E7"]);
  });
});
