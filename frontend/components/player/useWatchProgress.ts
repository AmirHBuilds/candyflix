"use client";

import { useEffect, useRef } from "react";
import { saveWatchProgress, saveWatchProgressBeacon, recordEpisodeVisit, recordMovieVisit, type WatchProgressPayload } from "@/lib/playback";

export type WatchIdentity = {
  tmdbId: number;
  mediaType: "movie" | "tv";
  seasonNumber?: number | null;
  episodeNumber?: number | null;
};

const AUTOSAVE_INTERVAL_MS = 10_000;

/**
 * Saves playback position:
 * - immediately when playback starts (so even a very brief watch before
 *   navigating away leaves a real saved row — see handlePlay below)
 * - every 10s while playing (periodic autosave)
 * - on pause and on seek (normal fetch — page is still alive)
 * - when the player unmounts (client-side navigation away, e.g. via a
 *   header link or a search result, where pagehide never fires)
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
  restored: boolean,
  // Settings -> Playback -> Save watch progress. Off stops every position
  // save below; the "this was opened" visit records still happen, so
  // Continue Watching and the last-watched episode keep working.
  saveProgress = true
) {
  const identityRef = useRef(identity);
  identityRef.current = identity;

  // Fires on mount, independent of `restored` — see recordEpisodeVisit's
  // docstring in lib/playback.ts for why this can't wait for the video
  // to actually start playing.
  useEffect(() => {
    if (identity.mediaType === "movie") {
      recordMovieVisit(identity.tmdbId);
      return;
    }
    if (identity.seasonNumber == null || identity.episodeNumber == null) return;
    recordEpisodeVisit(identity.tmdbId, identity.seasonNumber, identity.episodeNumber);
    // Deliberately keyed on the episode identity, not identity as a
    // whole reference — a new episode should record a new visit; a
    // parent re-render with the same episode should not re-fire this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity.mediaType, identity.tmdbId, identity.seasonNumber, identity.episodeNumber]);

  useEffect(() => {
    if (!restored || !saveProgress) return;
    const video = videoRef.current;
    if (!video) return;

    function buildPayload(): WatchProgressPayload | null {
      // Uses the element captured when this effect ran, NOT
      // videoRef.current: React detaches refs before running passive
      // cleanups on unmount, so the ref is already null by the time the
      // final save below needs it.
      const v = video;
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

    function handlePlay() {
      // A near-immediate save the moment playback actually starts, on
      // top of the 10s interval/pause/seek triggers above — without
      // this, a very brief watch (a few seconds, then navigating away)
      // could end up with no saved row at all if the unload beacon
      // doesn't land in time, which would make the "resume point" and
      // "In progress" indicators look stuck on stale data even though
      // the person genuinely did start watching something new.
      saveNow();
    }
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

    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("seeked", handleSeeked);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      // Leaving the player through a client-side route (header links,
      // a search result) never fires pagehide — the page isn't
      // unloading — so without this the last stretch since the previous
      // save was lost. Beacon rather than fetch: it's fire-and-forget
      // and survives whatever navigation is happening right now.
      saveBeacon();
      clearInterval(interval);
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("seeked", handleSeeked);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [videoRef, restored, saveProgress, identity.tmdbId, identity.mediaType, identity.seasonNumber, identity.episodeNumber]);
}
