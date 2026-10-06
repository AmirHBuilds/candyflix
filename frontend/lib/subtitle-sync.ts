import { getApiBaseUrl } from "@/lib/api-client";
import type { SubtitleTrack } from "@/lib/playback";
import type { WatchIdentity } from "@/components/player/useWatchProgress";

export type SyncState = "idle" | "queued" | "running" | "done" | "unchanged" | "failed";

export type SyncStatus = {
  state: SyncState;
  percent: number;
  stage: string | null;
  message: string | null;
  // Set when state is "done": the re-timed subtitle, kept on the server.
  track: SubtitleTrack | null;
};

export const SYNC_ACTIVE: SyncState[] = ["queued", "running"];

function identityParams(identity: WatchIdentity): Record<string, string> {
  const p: Record<string, string> = { media_type: identity.mediaType, tmdb_id: String(identity.tmdbId) };
  if (identity.seasonNumber != null) p.season_number = String(identity.seasonNumber);
  if (identity.episodeNumber != null) p.episode_number = String(identity.episodeNumber);
  return p;
}

// Where the sync for this video + subtitle stands. The state lives on the
// server, so asking again after a page refresh finds the same running job.
export async function getSyncStatus(identity: WatchIdentity, subtitleUrl: string): Promise<SyncStatus> {
  const qs = new URLSearchParams({ ...identityParams(identity), subtitle_url: subtitleUrl });
  const res = await fetch(`${getApiBaseUrl()}/subtitle-sync/status?${qs}`, { credentials: "include" });
  if (!res.ok) throw new Error("Couldn't check the sync.");
  return res.json();
}

export async function startSync(identity: WatchIdentity, track: SubtitleTrack): Promise<SyncStatus> {
  const res = await fetch(`${getApiBaseUrl()}/subtitle-sync`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      media_type: identity.mediaType,
      tmdb_id: identity.tmdbId,
      season_number: identity.seasonNumber ?? null,
      episode_number: identity.episodeNumber ?? null,
      subtitle_url: track.url,
      language: track.language,
      label: track.label,
    }),
  });
  if (!res.ok) {
    let detail = "Couldn't start the sync.";
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      // keep the fallback
    }
    throw new Error(detail);
  }
  return res.json();
}
