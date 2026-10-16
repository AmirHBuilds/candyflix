import { fetchWithTimeout, getApiBaseUrl } from "@/lib/api-client";

const sent = new Set<string>();

/**
 * Tells the server something broke in this browser (a crashed page, a video that couldn't play), so the admins see it in
 * the error log and on Telegram. Never throws, never reports the same thing twice from one page load, and sends
 * nothing private: just the message, the page address and a short stack.
 */
export function reportClientError(kind: "page" | "player", error: unknown, extra?: string): void {
  try {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 400) || "Unknown problem";
    const page = typeof window !== "undefined" ? window.location.pathname.slice(0, 200) : undefined;
    const key = `${kind}:${page}:${message}`;
    if (sent.has(key) || sent.size > 20) return;
    sent.add(key);
    const detail = [extra, error instanceof Error ? error.stack : undefined].filter(Boolean).join("\n").slice(0, 3000) || undefined;
    void fetchWithTimeout(`${getApiBaseUrl()}/client-errors`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, message, page, detail }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // reporting must never be a second problem
  }
}
