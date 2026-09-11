"use client";

import { useEffect, useRef } from "react";
import { saveWatchProgress, saveWatchProgressBeacon, type WatchProgressPayload } from "@/lib/playback";

export type WatchIdentity = {
  tmdbId: number;
  mediaType: "movie" | "tv";
  seasonNumber?: number | null;
  episodeNumber?: number | null;
};

const AUTOSAVE_INTERVAL_MS = 10_000;

/**
 * Saves playback position:
 * - every 10s while playing (periodic autosave)
 * - on pause and on seek (normal fetch — page is still alive)
 * - on visibilitychange (tab backgrounded) and pagehide (navigating
 *   away/closing) via sendBeacon, which is built specifically to
 *   survive a page teardown that would kill a normal fetch mid-flight
 *
 * Nothing can guarantee capturing a hard crash/force-quit, but this
 * combination covers the overwhelming majority of real usage — worst
 * case you lose the last ~10s, not the whole session.
 *
 * `restored` MUST stay false until VideoPlayer has either applied the
 * saved resume position to the video element or decided there's nothing
 * to resume (see attemptResume() in VideoPlayer.tsx). This is a fix for a
 * real bug: pause/seeked events firing during load — before the resume
 * seek had actually taken effect — used to read currentTime as 0 and post
 * that, silently overwriting a real saved position with 0 seconds. Rather
 * than trying to filter out "bad" 0 values (0 is also a legitimate real
 * position), we just don't attach any save-triggering listener, and don't
 * start the autosave interval, until restoration is confirmed complete.
 */
export function useWatchProgress(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  identity: WatchIdentity,
  restored: boolean
) {
  const identityRef = useRef(identity);
  identityRef.current = identity;

  useEffect(() => {
    if (!restored) return;
    const video = videoRef.current;
    if (!video) return;

    function buildPayload(): WatchProgressPayload | null {
      const v = videoRef.current;
      if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return null;
      const id = identityRef.current;
      return {
        tmdb_id: id.tmdbId,
        media_type: id.mediaType,
        season_number: id.seasonNumber ?? null,
        episode_number: id.episodeNumber ?? null,
        position_seconds: v.currentTime,
        duration_seconds: v.duration,
      };
    }

    function saveNow() {
      const payload = buildPayload();
      if (payload) void saveWatchProgress(payload);
    }

    function saveBeacon() {
      const payload = buildPayload();
      if (payload) saveWatchProgressBeacon(payload);
    }

    const interval = setInterval(() => {
      if (!video.paused) saveNow();
    }, AUTOSAVE_INTERVAL_MS);

    function handlePause() {
      saveNow();
    }
    function handleSeeked() {
      saveNow();
    }
    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") saveBeacon();
    }
    function handlePageHide() {
      saveBeacon();
    }

    video.addEventListener("pause", handlePause);
    video.addEventListener("seeked", handleSeeked);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      clearInterval(interval);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("seeked", handleSeeked);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [videoRef, restored, identity.tmdbId, identity.mediaType, identity.seasonNumber, identity.episodeNumber]);
}
