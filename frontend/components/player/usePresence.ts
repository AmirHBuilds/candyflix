"use client";

import { useEffect, useRef } from "react";
import { sendPresence, stopPresence } from "@/lib/playback";
import type { WatchIdentity } from "@/components/player/useWatchProgress";

export const PRESENCE_INTERVAL_MS = 15_000;

/**
 * Tells the server "this person has this video open" every 15 s (and when
 * playing / pausing), so the admin's "Watching now" is live. It fades by
 * itself on the server after 45 s of silence; leaving the player says
 * "stopped" at once. Independent of "Save watch progress".
 */
export function usePresence(videoRef: React.RefObject<HTMLVideoElement | null>, identity: WatchIdentity) {
  const identityRef = useRef(identity);
  identityRef.current = identity;

  useEffect(() => {
    const beat = () => {
      const video = videoRef.current;
      sendPresence(identityRef.current, {
        positionSeconds: video?.currentTime ?? 0,
        durationSeconds: video?.duration ?? 0,
        playing: !!video && !video.paused && !video.ended,
      });
    };
    beat();
    const timer = setInterval(beat, PRESENCE_INTERVAL_MS);
    const video = videoRef.current;
    video?.addEventListener("play", beat);
    video?.addEventListener("pause", beat);
    const onHide = () => stopPresence();
    window.addEventListener("pagehide", onHide);
    return () => {
      clearInterval(timer);
      video?.removeEventListener("play", beat);
      video?.removeEventListener("pause", beat);
      window.removeEventListener("pagehide", onHide);
      stopPresence();
    };
    // One heartbeat loop per video.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity.mediaType, identity.tmdbId, identity.seasonNumber, identity.episodeNumber]);
}
