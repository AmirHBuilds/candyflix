import { getApiBaseUrl } from "@/lib/api-client";

export type AIStatus = { enabled: boolean; limit: number | null; used: number; remaining: number | null };

export type AskTitle = {
  tmdb_id: number;
  media_type: "movie" | "tv";
  title: string;
  year: string | null;
  overview: string;
  genres: string[];
  poster_path: string | null;
  backdrop_path: string | null;
  rating: number | null;
  runtime_minutes: number | null;
  seasons: number | null;
  trailer_key: string | null;
  reason: string | null;
};

export type AskResponse = {
  note: string | null;
  for_you: AskTitle[];
  general: AskTitle[];
  used_history: boolean;
  /** null = no limit (admins) */
  remaining: number | null;
  limit: number | null;
};

/** "sad movie about a lonely girl" looks like a request; "inception" looks like a title. */
export function looksLikeRequest(text: string): boolean {
  const t = text.trim();
  if (t.length < 12) return false;
  const words = t.split(/\s+/).length;
  if (words >= 4) return true;
  return /^(i|i'm|im|i am|i want|i feel|something|anything|a movie|a show|give me|recommend|suggest)\b/i.test(t);
}

export async function getAIStatus(): Promise<AIStatus | null> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/ai/status`, { credentials: "include", cache: "no-store" });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export async function askAI(prompt: string): Promise<AskResponse> {
  const res = await fetch(`${getApiBaseUrl()}/ai/ask`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) {
    let message = "The AI couldn't answer right now. Please try again.";
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") message = body.detail;
      else if (Array.isArray(body?.detail)) message = "Say a little more about what you'd like to watch.";
    } catch {
      // keep the default
    }
    throw new Error(message);
  }
  return res.json();
}
