/** Client for the watch assistant (the player's "Ask about this" panel): /api/ai/watch. */
import { getApiBaseUrl } from "@/lib/api-client";
import type { AIStatus } from "@/lib/ai";

export type WatchIntent = "ask" | "recap_all" | "recap_so_far" | "just_happened" | "previously";

export type WatchTurn = { role: "user" | "assistant"; text: string; position_seconds?: number };

export type WatchAsk = {
  media_type: "movie" | "tv";
  tmdb_id: number;
  season_number?: number | null;
  episode_number?: number | null;
  question: string;
  position_seconds: number;
  intent: WatchIntent;
  history: WatchTurn[];
};

export type WatchAnswer = { answer: string; has_dialogue: boolean; remaining: number | null; limit: number | null };

/** 12:34, or 1:02:03 */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

export async function getWatchAIStatus(): Promise<AIStatus | null> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/ai/watch/status`, { credentials: "include", cache: "no-store" });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export async function askWatchAI(body: WatchAsk): Promise<WatchAnswer> {
  const res = await fetch(`${getApiBaseUrl()}/ai/watch/ask`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let message = "The assistant couldn't answer right now. Please try again.";
    try {
      const data = await res.json();
      if (typeof data?.detail === "string") message = data.detail;
    } catch {
      // keep the default
    }
    throw new Error(message);
  }
  return res.json();
}
