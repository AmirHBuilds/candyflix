"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WatchIdentity } from "@/components/player/useWatchProgress";
import type { SubtitleTrack } from "@/lib/playback";
import { getSyncStatus, startSync, SYNC_ACTIVE, type SyncStatus } from "@/lib/subtitle-sync";

const POLL_MS = 1000;

// "Sync subtitle": the server listens to this video's audio and re-times the
// subtitle (also when the delay changes along the film), then keeps the result.
// The button fills left to right as the job progresses; the line under it says
// what is happening. The job lives on the server, so on mount (e.g. after a
// page refresh) we ask for its status and carry on showing it.
export default function SyncSubtitleControl({
  track,
  identity,
  onSynced,
}: {
  track: SubtitleTrack;
  identity: WatchIdentity;
  onSynced: (track: SubtitleTrack) => void;
}) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const onSyncedRef = useRef(onSynced);
  onSyncedRef.current = onSynced;
  const alive = useRef(true);

  const apply = useCallback((s: SyncStatus) => {
    setStatus(s);
    if (s.state === "done" && s.track) onSyncedRef.current(s.track);
  }, []);

  // Look the job up whenever the track changes (and on first open).
  useEffect(() => {
    alive.current = true;
    setStatus(null);
    setError(null);
    getSyncStatus(identity, track.url)
      .then((s) => alive.current && apply(s))
      .catch(() => {
        // Silent: the button simply stays available.
      });
    return () => {
      alive.current = false;
    };
  }, [track.url, identity.mediaType, identity.tmdbId, identity.seasonNumber, identity.episodeNumber, apply]);

  const active = status ? SYNC_ACTIVE.includes(status.state) : false;

  // Poll while a job is queued or running.
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      getSyncStatus(identity, track.url)
        .then((s) => alive.current && apply(s))
        .catch(() => {});
    }, POLL_MS);
    return () => clearInterval(id);
  }, [active, track.url, identity.mediaType, identity.tmdbId, identity.seasonNumber, identity.episodeNumber, apply]);

  async function begin() {
    setError(null);
    setStarting(true);
    try {
      apply(await startSync(identity, track));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the sync.");
    } finally {
      setStarting(false);
    }
  }

  const busy = active || starting;
  const percent = busy ? Math.max(status?.percent ?? 0, 2) : 0;
  const line = error ?? (busy ? (status?.message ?? "Starting…") : status?.state === "idle" ? null : status?.message);
  const lineIsProblem = !!error || status?.state === "failed";

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={begin}
        disabled={busy}
        aria-busy={busy}
        aria-label={busy ? `Syncing subtitle, ${percent}%` : "Sync subtitle"}
        className="relative overflow-hidden rounded-lg bg-white/[0.08] px-3 py-2 text-sm font-medium text-white transition-colors enabled:hover:bg-white/[0.14] disabled:cursor-default"
      >
        <span
          aria-hidden
          data-testid="sync-fill"
          className="absolute inset-y-0 left-0 bg-accent/60 transition-[width] duration-1000 ease-linear"
          style={{ width: `${percent}%` }}
        />
        <span className="relative">{busy ? `Syncing… ${percent}%` : "Sync subtitle"}</span>
      </button>
      {line ? (
        <span role="status" aria-live="polite" className={`text-xs ${lineIsProblem ? "text-red-400" : "text-white/50"}`}>
          {line}
        </span>
      ) : (
        <span className="text-[11px] leading-snug text-white/40">
          Matches this subtitle to the video&apos;s audio. Takes a few seconds, and the result is kept for next time.
        </span>
      )}
    </div>
  );
}
