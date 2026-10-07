import { getApiBaseUrl } from "@/lib/api-client";

export type RatingSourceId = "tmdb" | "imdb" | "rotten_tomatoes" | "metacritic";

// The order scores are shown in, and what to call them. Icons: /public/ratings/<id>.svg
export const RATING_SOURCES: { id: RatingSourceId; label: string; description: string }[] = [
  { id: "tmdb", label: "TMDB", description: "The community score this site already uses." },
  { id: "imdb", label: "IMDb", description: "Viewers' rating out of 10." },
  { id: "rotten_tomatoes", label: "Rotten Tomatoes", description: "The share of critics who liked it." },
  { id: "metacritic", label: "Metacritic", description: "Critics' weighted score out of 100." },
];

export type ExternalRating = {
  source: Exclude<RatingSourceId, "tmdb">;
  label: string;
  display: string;
  suffix: string;
  value: number;
  votes: number | null;
  url: string | null;
};

export type RatingsResponse = { ratings: ExternalRating[]; configured: boolean };

export async function getRatings(mediaType: "movie" | "tv", tmdbId: number): Promise<RatingsResponse> {
  const res = await fetch(`${getApiBaseUrl()}/ratings/${mediaType}/${tmdbId}`, { credentials: "include" });
  if (!res.ok) return { ratings: [], configured: true };
  return res.json();
}

export function formatVotes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}
