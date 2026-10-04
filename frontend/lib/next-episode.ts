import type { Episode, SeasonDetail, SeasonSummary } from "@/lib/media";

export type EpisodeRef = { season: number; episode: Episode };

/**
 * The episodes before and after the current one — across season
 * boundaries, which is what both the player's prev/next buttons and
 * "Autoplay next episode" rely on.
 *
 * - Inside a season it's simply the neighbouring episode.
 * - At the end of a season it rolls into the first episode of the next
 *   season that has episodes (skipping empty ones); at the start, into the
 *   last episode of the previous one. Season 0 ("Specials") is never part
 *   of the chain: finishing the last episode of a series shouldn't drop
 *   into behind-the-scenes extras.
 * - An episode that hasn't aired yet isn't offered as "next" (there's
 *   nothing to play). `air_date` null (unknown) is treated as available.
 * - The last episode of the last season has no next (autoplay stops).
 *
 * `loadSeason` is only called when a boundary is actually crossed, so the
 * common case costs no extra request.
 */
export async function findAdjacentEpisodes(args: {
  seasons: SeasonSummary[];
  seasonNumber: number;
  episodes: Episode[];
  episodeNumber: number;
  loadSeason: (seasonNumber: number) => Promise<SeasonDetail>;
  today?: Date;
}): Promise<{ prev: EpisodeRef | null; next: EpisodeRef | null }> {
  const { seasons, seasonNumber, episodes, episodeNumber, loadSeason } = args;
  const today = args.today ?? new Date();
  const index = episodes.findIndex((e) => e.episode_number === episodeNumber);

  const aired = (e: Episode) => !e.air_date || new Date(e.air_date).getTime() <= today.getTime();

  let prev: EpisodeRef | null =
    index > 0 ? { season: seasonNumber, episode: episodes[index - 1] } : null;
  let next: EpisodeRef | null =
    index >= 0 && index < episodes.length - 1 && aired(episodes[index + 1])
      ? { season: seasonNumber, episode: episodes[index + 1] }
      : null;

  const atEnd = index >= 0 && index === episodes.length - 1;

  if (!prev) {
    const earlier = seasons
      .filter((s) => s.season_number > 0 && s.season_number < seasonNumber && s.episode_count > 0)
      .sort((a, b) => b.season_number - a.season_number);
    for (const s of earlier) {
      const detail = await loadSeason(s.season_number);
      const last = detail.episodes[detail.episodes.length - 1];
      if (last) {
        prev = { season: s.season_number, episode: last };
        break;
      }
    }
  }

  if (!next && atEnd) {
    const later = seasons
      .filter((s) => s.season_number > seasonNumber && s.episode_count > 0)
      .sort((a, b) => a.season_number - b.season_number);
    for (const s of later) {
      const detail = await loadSeason(s.season_number);
      const first = detail.episodes[0];
      if (first) {
        if (aired(first)) next = { season: s.season_number, episode: first };
        break; // a season that hasn't started airing ends the chain
      }
    }
  }

  return { prev, next };
}
