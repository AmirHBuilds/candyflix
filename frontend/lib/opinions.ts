/** Client for /api/opinions — what people think of a title or episode, replies and likes. */
import { fetchWithTimeout, getApiBaseUrl } from "@/lib/api-client";
import type { MediaType } from "@/lib/media";

export type Scope = { media_type: MediaType; tmdb_id: number; season_number?: number; episode_number?: number };
export type Person = { id: string; name: string; avatar_url: string | null };

export type Opinion = {
  id: string;
  body: string;
  created_at: string;
  author: Person | null; // null = posted anonymously
  is_anonymous: boolean;
  mine: boolean;
  likes: number;
  liked_by_me: boolean;
  season_number: number; // -1 = about the whole title
  episode_number: number;
  real_author: string | null; // admins only
  hidden: boolean; // admins only
  replies: Opinion[];
};

export type LikeSummary = { count: number; you_liked: boolean; people: Person[]; more: number };

export type TitleOpinions = {
  enabled: boolean;
  moderator: boolean;
  can_comment: boolean;
  why_not: string | null;
  allow_anonymous: boolean;
  allow_replies: boolean;
  anonymous_default: boolean;
  likes: LikeSummary;
  comment_count: number;
  opinions: Opinion[];
};

export type Latest = {
  id: string;
  body: string;
  created_at: string;
  author: Person | null;
  season_number: number;
  episode_number: number;
};

/** One title and everything the family did on it. */
export type FeedTitle = {
  media_type: MediaType;
  tmdb_id: number;
  title: string;
  poster_path: string | null;
  backdrop_path: string | null;
  latest: Latest | null;
  comment_count: number; // all of them, yours included
  other_comment_count: number; // by other people: the card names those, never you
  likes: LikeSummary; // count includes your own like; people/more are other people only
};

export type Feed = { enabled: boolean; items: FeedTitle[] };

const base = () => `${getApiBaseUrl()}/opinions`;
const json = { "Content-Type": "application/json" };

async function fail(res: Response, fallback: string): Promise<never> {
  const body = await res.json().catch(() => ({}));
  const d = body?.detail;
  throw new Error(typeof d === "string" ? d : Array.isArray(d) ? d[0]?.msg?.replace(/^Value error, /, "") || fallback : fallback);
}

export async function getTitleOpinions(scope: Scope): Promise<TitleOpinions> {
  const q = new URLSearchParams({ media_type: scope.media_type, tmdb_id: String(scope.tmdb_id) });
  if (scope.season_number != null) q.set("season_number", String(scope.season_number));
  if (scope.episode_number != null) q.set("episode_number", String(scope.episode_number));
  const res = await fetchWithTimeout(`${base()}/title?${q}`, { credentials: "include", cache: "no-store" });
  if (!res.ok) await fail(res, "Couldn't load opinions.");
  return res.json();
}

export async function postOpinion(scope: Scope, body: string, anonymous: boolean, parentId?: string): Promise<Opinion> {
  const res = await fetchWithTimeout(base(), {
    method: "POST",
    credentials: "include",
    headers: json,
    body: JSON.stringify({ ...scope, body, anonymous, parent_id: parentId ?? null }),
  });
  if (!res.ok) await fail(res, "Couldn't post that.");
  return res.json();
}

export async function deleteOpinion(id: string): Promise<void> {
  const res = await fetchWithTimeout(`${base()}/${id}`, { method: "DELETE", credentials: "include" });
  if (!res.ok) await fail(res, "Couldn't delete that.");
}

export async function likeOpinion(id: string, liked: boolean): Promise<{ likes: number; liked_by_me: boolean }> {
  const res = await fetchWithTimeout(`${base()}/${id}/like?liked=${liked}`, { method: "PUT", credentials: "include" });
  if (!res.ok) await fail(res, "Couldn't save that.");
  return res.json();
}

export async function likeTitle(scope: Scope, liked: boolean): Promise<LikeSummary> {
  const res = await fetchWithTimeout(`${base()}/likes/title`, {
    method: "PUT",
    credentials: "include",
    headers: json,
    body: JSON.stringify({ ...scope, liked }),
  });
  if (!res.ok) await fail(res, "Couldn't save that.");
  return (await res.json()).likes;
}

export async function getFeed(init?: RequestInit): Promise<Feed> {
  const res = await fetchWithTimeout(`${base()}/feed`, { credentials: "include", cache: "no-store", ...init });
  if (!res.ok) throw new Error("Couldn't load the feed.");
  return res.json();
}

/** "Candy liked this", "Candy and Mom liked this", "Candy, Mom and Dad + 2 liked this", "You and Candy liked this". */
export function likeSentence(l: LikeSummary): string {
  const names = l.people.map((p) => p.name);
  if (l.you_liked) names.unshift("You");
  if (names.length === 0) return "";
  const more = l.more;
  const list =
    names.length === 1
      ? names[0]
      : more > 0
        ? names.join(", ")
        : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const tail = more > 0 ? ` + ${more} ${more === 1 ? "other" : "others"}` : "";
  const verb = names.length === 1 && more === 0 && names[0] !== "You" ? "liked this" : "liked this";
  return `${list}${tail} ${verb}`;
}

export async function getBannerSocial(items: { media_type: MediaType; tmdb_id: number }[]): Promise<Feed> {
  const q = items.map((i) => `${i.media_type}:${i.tmdb_id}`).join(",");
  const res = await fetchWithTimeout(`${base()}/banner?items=${encodeURIComponent(q)}`, { credentials: "include", cache: "no-store" });
  if (!res.ok) throw new Error("Couldn't load the family's activity.");
  return res.json();
}

/** Where an opinion was written, e.g. "Season 2 · Episode 3"; null when it is about the whole title. */
export function whereLabel(o: { season_number: number; episode_number: number }): string | null {
  if (o.season_number < 0) return null;
  return o.episode_number >= 0 ? `Season ${o.season_number} · Episode ${o.episode_number}` : `Season ${o.season_number}`;
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}
