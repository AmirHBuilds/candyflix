import { fetchWithTimeout, getApiBaseUrl } from "@/lib/api-client";

export type FeedbackKind = "problem" | "idea" | "other";

export const FEEDBACK_KINDS: { value: FeedbackKind; label: string }[] = [
  { value: "idea", label: "An idea" },
  { value: "problem", label: "A problem" },
  { value: "other", label: "Something else" },
];

export const FEEDBACK_MAX = 2000;

/** Sends a note to the admins. Throws a readable message when it can't. */
export async function sendFeedback(kind: FeedbackKind, message: string, page?: string): Promise<void> {
  const res = await fetchWithTimeout(`${getApiBaseUrl()}/feedback`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, message, page: page ? page.slice(0, 200) : null }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const d = body?.detail;
    throw new Error((typeof d === "string" ? d : Array.isArray(d) ? d[0]?.msg?.replace(/^Value error, /, "") : null) || "Couldn't send that. Try again.");
  }
}
