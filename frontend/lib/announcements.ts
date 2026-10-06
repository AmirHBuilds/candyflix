/** Messages from the admin that the signed-in person still has to read (Phase 10c). */
import { getApiBaseUrl } from "@/lib/api-client";

export type PendingAnnouncement = { id: string; title: string; body: string; created_at: string };

export async function getPendingAnnouncements(): Promise<PendingAnnouncement[]> {
  const res = await fetch(`${getApiBaseUrl()}/announcements/pending`, { credentials: "include", cache: "no-store" });
  if (!res.ok) throw new Error("Couldn't load messages.");
  return res.json();
}

export async function acknowledgeAnnouncement(id: string): Promise<void> {
  const res = await fetch(`${getApiBaseUrl()}/announcements/${id}/ack`, { method: "POST", credentials: "include" });
  if (!res.ok) throw new Error("Couldn't save that. Please try again.");
}
