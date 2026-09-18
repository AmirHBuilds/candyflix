"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { getStaticOrigin } from "@/lib/api-client";
import type { PlaybackSource, SubtitleTrack } from "@/lib/playback";
import { useWatchProgress, type WatchIdentity } from "@/components/player/useWatchProgress";
import { parseSubtitles, type Cue } from "@/components/player/subtitle-utils";
import {
  loadSubtitleSettings,
  saveSubtitleSettings,
  type SubtitleSettings,
} from "@/components/player/subtitle-settings";
import SubtitleOverlay from "@/components/player/SubtitleOverlay";
import SubtitleSettingsPanel from "@/components/player/SubtitleSettingsPanel";

const SKIP_SECONDS = 10;
const SEEK_STEP_SECONDS = 5;
const AUTO_HIDE_MS = 3000;
const UP_NEXT_THRESHOLD_SECONDS = 20;
const DOUBLE_TAP_MS = 300;
const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export default function VideoPlayer({
  source,
  title,
  identity,
  backHref,
  nextEpisode,
  prevEpisode,
}: {
  source: PlaybackSource;
  title: string;
  identity: WatchIdentity;
  backHref: string;
  nextEpisode?: { href: string; label: string } | null;
  prevEpisode?: { href: string; label: string } | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapRef = useRef<{ zone: "left" | "right"; time: number } | null>(null);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [scrubHover, setScrubHover] = useState(false);
  const [scrubDragging, setScrubDragging] = useState(false);
  const scrubTrackRef = useRef<HTMLDivElement>(null);
  // Subtitles found via online search (Phase 5b) and downloaded. `source`
  // is an immutable prop from the initial page load, so newly-added
  // tracks live here instead and get merged into every place that reads
  // the subtitle list.
  const [onlineTracks, setOnlineTracks] = useState<SubtitleTrack[]>([]);
  const allTracks = useMemo(() => [...source.subtitles, ...onlineTracks], [source.subtitles, onlineTracks]);
  const [buffering, setBuffering] = useState(true);
  const bufferingRef = useRef(buffering);
  useEffect(() => {
    bufferingRef.current = buffering;
  }, [buffering]);
  const [error, setError] = useState<string | null>(null);
  // True when the resume-fallback timer fires and the video STILL hasn't
  // reported a finite duration — the signature of the browser failing to
  // locate the MP4's moov atom (metadata) for this particular load. Shows a
  // manual retry affordance instead of leaving the person stuck behind an
  // unexplained spinner with no way out except a full page reload.
  const [videoStuck, setVideoStuck] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  // Single gear menu, YouTube-style: root list -> drill into "speed" or
  // "subtitles" -> back arrow returns to root. Replaces the old separate
  // speed-menu/subtitle-settings toggles now that both live behind one gear.
  const [settingsMenu, setSettingsMenu] = useState<"root" | "speed" | "subtitles" | null>(null);

  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null);
  const selectedLanguageRef = useRef<string | null>(null);
  const lastSubtitleLanguageRef = useRef<string | null>(null);
  const [cues, setCues] = useState<Cue[]>([]);
  const [subtitleSettings, setSubtitleSettings] = useState<SubtitleSettings>(loadSubtitleSettings());

  const [upNextDismissed, setUpNextDismissed] = useState(false);
  const [ended, setEnded] = useState(false);
  const [skipPulse, setSkipPulse] = useState<{ side: "left" | "right"; nonce: number } | null>(null);
  const [centerPulse, setCenterPulse] = useState<{ icon: "play" | "pause"; nonce: number } | null>(null);

  // Becomes true once we've either applied the saved resume position or
  // decided there's nothing to resume. useWatchProgress doesn't attach any
  // save-triggering listeners until this flips — see its file header for why.
  const [progressRestored, setProgressRestored] = useState(false);
  const resumeAttemptedRef = useRef(false);

  useWatchProgress(videoRef, identity, progressRestored);

  const videoUrl = `${getStaticOrigin()}${source.url}`;

  // --- Subtitle track loading ---
  useEffect(() => {
    if (!selectedLanguage) {
      setCues([]);
      return;
    }
    const track = allTracks.find((t) => t.language === selectedLanguage);
    if (!track) {
      setCues([]);
      return;
    }
    let cancelled = false;
    fetch(`${getStaticOrigin()}${track.url}`)
      .then((res) => res.text())
      .then((text) => {
        if (!cancelled) setCues(parseSubtitles(text));
      })
      .catch(() => {
        if (!cancelled) setCues([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedLanguage, allTracks]);

  function updateSubtitleSettings(next: SubtitleSettings) {
    setSubtitleSettings(next);
    saveSubtitleSettings(next);
  }

  // --- Video element event wiring ---
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Applies the saved resume position exactly once. Gated on a real,
    // finite duration: some browsers briefly report duration as
    // Infinity/NaN on the very first `loadedmetadata` for a range-seekable
    // file that hasn't buffered enough yet, so relying on that single event
    // could silently skip the resume seek. We retry on `durationchange` and
    // `canplay`, and fall back to marking restoration "done" (with no seek)
    // after a short timeout so autosave never stays disabled indefinitely.
    //
    // This function only ever DECIDES where to seek and flips
    // `progressRestored` — it never itself sends anything to the backend.
    // useWatchProgress is the thing that saves, and it refuses to attach
    // any save-triggering listeners until `progressRestored` is true. That
    // split is what actually fixes the "resume gets overwritten with 0"
    // bug: previously, save listeners were live from the very first render,
    // so any early pause/seeked event firing before this seek had actually
    // taken effect — a legitimate spurious event during load, not a mistake
    // in the seek logic itself — would read currentTime as 0 and post that,
    // clobbering the real saved position. Now there is simply no listener
    // registered yet for that to happen through.
    // Temporary diagnostic instrumentation for tracking down an intermittent
    // stall where the video stops requesting further data and buffering
    // never clears. Logs to console so a repro can be captured and compared
    // against what actually happened. Safe to remove once the underlying
    // cause is confirmed and fixed; harmless to leave (console.debug only,
    // this is a private single-developer-visible app, not shipped to users
    // at large).
    const log = (...args: unknown[]) => console.debug("[VideoPlayer]", ...args);
    const watchdog = setInterval(() => {
      const v = videoRef.current;
      if (!v) return;
      const buffered: Array<[number, number]> = [];
      for (let i = 0; i < v.buffered.length; i++) buffered.push([v.buffered.start(i), v.buffered.end(i)]);
      log("watchdog", {
        buffering: bufferingRef.current,
        paused: v.paused,
        currentTime: v.currentTime.toFixed(1),
        readyState: v.readyState, // 0=NOTHING 1=METADATA 2=CURRENT_DATA 3=FUTURE_DATA 4=ENOUGH_DATA
        networkState: v.networkState, // 0=EMPTY 1=IDLE 2=LOADING 3=NO_SOURCE
        buffered,
        error: v.error ? { code: v.error.code, message: v.error.message } : null,
      });
    }, 3000);

    function attemptResume() {
      if (resumeAttemptedRef.current || !video) return;
      if (!Number.isFinite(video.duration) || video.duration <= 0) {
        log("attemptResume: duration not finite yet, waiting", video.duration);
        return;
      }
      const resume = source.resume_position_seconds;
      if (resume && resume > 3 && resume < video.duration - 5) {
        log("attemptResume: seeking to saved position", resume);
        video.currentTime = resume;
      } else {
        log("attemptResume: nothing to resume", { resume, duration: video.duration });
      }
      resumeAttemptedRef.current = true;
      setProgressRestored(true);
    }

    const resumeFallbackTimer = setTimeout(() => {
      if (!resumeAttemptedRef.current) {
        const v = videoRef.current;
        const stuck = !v || !Number.isFinite(v.duration) || v.duration <= 0;
        log("attemptResume: 8s fallback fired", { stuck, duration: v?.duration });
        resumeAttemptedRef.current = true;
        setProgressRestored(true);
        if (stuck) setVideoStuck(true);
      }
    }, 8000);

    function onLoadedMetadata() {
      if (!video) return;
      log("loadedmetadata", { duration: video.duration, readyState: video.readyState });
      setDuration(video.duration);
      attemptResume();
      setBuffering(false);
    }
    function onDurationChange() {
      if (!video) return;
      log("durationchange", video.duration);
      setDuration(video.duration);
      if (Number.isFinite(video.duration) && video.duration > 0) setVideoStuck(false);
      attemptResume();
    }
    function onTimeUpdate() {
      if (video) setCurrentTime(video.currentTime);
    }
    // Drives the scrub bar's grey "load progress" fill. Finds whichever
    // buffered range contains (or immediately precedes) the current time,
    // since `buffered` can contain multiple disjoint ranges after seeking.
    function onProgress() {
      if (!video) return;
      let end = 0;
      for (let i = 0; i < video.buffered.length; i++) {
        if (video.buffered.start(i) <= video.currentTime) {
          end = Math.max(end, video.buffered.end(i));
        }
      }
      setBufferedEnd(end);
    }
    function onPlay() {
      log("play");
      setPlaying(true);
      setEnded(false);
      // Restarts the idle countdown from the moment playback actually
      // begins, so the bar fades out a few seconds after pressing play
      // even without any further mouse movement — matching the "pause
      // pins controls, play lets them fade" behavior YouTube uses.
      scheduleHide();
    }
    function onPause() {
      log("pause", { currentTime: videoRef.current?.currentTime });
      setPlaying(false);
      // Paused video always keeps its controls on screen — there's
      // nothing to "enjoy watching" uninterrupted while stopped, and
      // hiding them would strand the person with no way to resume.
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
      setShowControls(true);
    }
    function onWaiting() {
      log("waiting (buffering=true)", { currentTime: videoRef.current?.currentTime });
      setBuffering(true);
    }
    function onCanPlay() {
      log("canplay (buffering=false)");
      setBuffering(false);
      setVideoStuck(false);
      attemptResume();
    }
    // Real, standalone bug (not introduced by the resume fix, but much more
    // exposed by it): after the FIRST canplay, a stall mid-playback fires
    // `waiting` and then recovers via `playing`, not `canplay` again. With
    // no listener for `playing`, buffering stayed stuck at true forever
    // after any seek into an unbuffered part of the file — including our
    // resume seek, or just dragging the scrub bar — even though the video
    // was actually running underneath.
    function onPlaying() {
      log("playing (buffering=false)");
      setBuffering(false);
      setVideoStuck(false);
    }
    function onVolumeChange() {
      if (!video) return;
      setVolume(video.volume);
      setMuted(video.muted);
    }
    function onRateChange() {
      if (video) setPlaybackRate(video.playbackRate);
    }
    function onError() {
      log("error", videoRef.current?.error);
      setError("This video couldn't be played. Try refreshing the page.");
      setBuffering(false);
    }
    function onEnded() {
      log("ended");
      setEnded(true);
      setPlaying(false);
    }
    function onStalled() {
      log("stalled — browser expected data but the download has stopped");
    }
    function onSuspend() {
      log("suspend — browser paused fetching data (often means it thinks it has enough for now)");
    }

    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("durationchange", onDurationChange);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("progress", onProgress);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("volumechange", onVolumeChange);
    video.addEventListener("ratechange", onRateChange);
    video.addEventListener("error", onError);
    video.addEventListener("ended", onEnded);
    video.addEventListener("stalled", onStalled);
    video.addEventListener("suspend", onSuspend);

    // Real bug this fixes: React's effects run AFTER the DOM commit that
    // set the <video src>, on a separate tick from the actual attribute
    // assignment. If the browser resolves metadata fast enough (e.g. a
    // small/local/already-partially-cached fetch), `loadedmetadata` and
    // `canplay` can fire and complete BEFORE this effect finishes attaching
    // its listeners — the events fire into an empty room and are lost for
    // good, since they don't fire again. This exactly matches a real
    // observed case: the video's `duration` was fully known and readyState
    // was HAVE_ENOUGH_DATA, yet none of our handlers had ever run, and only
    // the 8s fallback timer eventually rescued things. Checking the
    // element's actual current state right here, once, covers whatever we
    // already missed.
    if (video.readyState >= 1) {
      log("readyState already >= HAVE_METADATA on listener attach — event was missed, running handler manually");
      onLoadedMetadata();
    }
    if (video.readyState >= 3) {
      log("readyState already >= HAVE_FUTURE_DATA on listener attach — event was missed, running handler manually");
      onCanPlay();
    }


    return () => {
      clearTimeout(resumeFallbackTimer);
      clearInterval(watchdog);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("durationchange", onDurationChange);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("progress", onProgress);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("volumechange", onVolumeChange);
      video.removeEventListener("ratechange", onRateChange);
      video.removeEventListener("error", onError);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("stalled", onStalled);
      video.removeEventListener("suspend", onSuspend);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.url]);

  // --- Fullscreen tracking ---
  useEffect(() => {
    function onFsChange() {
      setFullscreen(document.fullscreenElement === containerRef.current);
    }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // --- Auto-hide controls ---
  const scheduleHide = useCallback(() => {
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    hideTimeoutRef.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setShowControls(false);
    }, AUTO_HIDE_MS);
  }, []);

  function handleActivity() {
    setShowControls(true);
    scheduleHide();
  }

  const settingsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (settingsMenu === null) return;
    function onDocMouseDown(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsMenu(null);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [settingsMenu]);

  useEffect(() => {
    scheduleHide();
    return () => {
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, [scheduleHide]);

  useEffect(() => {
    selectedLanguageRef.current = selectedLanguage;
    if (selectedLanguage) lastSubtitleLanguageRef.current = selectedLanguage;
  }, [selectedLanguage]);

  useEffect(() => {
    if (!skipPulse) return;
    const t = setTimeout(() => setSkipPulse(null), 550);
    return () => clearTimeout(t);
  }, [skipPulse]);

  useEffect(() => {
    if (!centerPulse) return;
    const t = setTimeout(() => setCenterPulse(null), 700);
    return () => clearTimeout(t);
  }, [centerPulse]);

  // --- Controls ---
  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    const wasPaused = video.paused;
    if (wasPaused) void video.play();
    else video.pause();
    // Shows whichever icon represents the state just switched TO (a play
    // triangle when resuming, a pause bars when stopping) — a brief,
    // fading confirmation of what just happened, the same way YouTube's
    // center bubble works. Keyed by nonce so retriggering the same icon
    // twice in a row (e.g. rapid taps) still restarts the animation.
    setCenterPulse({ icon: wasPaused ? "play" : "pause", nonce: Date.now() });
  }

  function seekBy(delta: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.min(Math.max(video.currentTime + delta, 0), video.duration || Infinity);
  }

  function seekTo(seconds: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.min(Math.max(seconds, 0), video.duration || Infinity);
  }

  // Converts a pointer's clientX into a video-time seek target, based on
  // the scrub track's current on-screen bounds.
  function scrubPositionToTime(clientX: number): number {
    const track = scrubTrackRef.current;
    if (!track || !duration) return 0;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * duration;
  }

  // Dragging needs to keep tracking the pointer even once it leaves the
  // (thin) scrub track, so — same as a native range input — these listeners
  // live on the window for the duration of the drag rather than on the
  // track element itself.
  useEffect(() => {
    if (!scrubDragging) return;
    function move(clientX: number) {
      seekTo(scrubPositionToTime(clientX));
    }
    function onMouseMove(e: MouseEvent) {
      move(e.clientX);
    }
    function onTouchMove(e: TouchEvent) {
      if (e.touches[0]) move(e.touches[0].clientX);
    }
    function onUp() {
      setScrubDragging(false);
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("touchmove", onTouchMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchend", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrubDragging, duration]);

  function toggleMute() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
  }

  function changeVolume(v: number) {
    const video = videoRef.current;
    if (!video) return;
    video.volume = v;
    video.muted = v === 0;
  }

  function changeRate(rate: number) {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = rate;
  }

  async function toggleFullscreen() {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await containerRef.current.requestFullscreen();
    }
  }

  // Turns subtitles fully off, or back on at whichever language was last
  // selected (falling back to the first available track) — this is what
  // the main-bar CC button does; per-language choice and styling both
  // live in the Settings > Subtitles submenu instead.
  function handleCaptionsButtonClick() {
    // Nothing to toggle yet (the automatic default English fetch can come
    // up empty — no IMDb match, no English result, OpenSubtitles down) —
    // so open the picker instead of a no-op toggle. The picker's own
    // background language search can still find something even when the
    // automatic default didn't.
    if (allTracks.length === 0) {
      setSettingsMenu("subtitles");
      return;
    }
    toggleCaptions();
  }

  function toggleCaptions() {
    if (selectedLanguageRef.current) {
      setSelectedLanguage(null);
    } else {
      setSelectedLanguage(lastSubtitleLanguageRef.current ?? allTracks[0]?.language ?? null);
    }
  }

  function replay() {
    seekTo(0);
    void videoRef.current?.play();
  }

  // Forces a completely fresh fetch of the video resource, staying on the
  // same page — recovers from the "browser never resolved a duration"
  // stuck state without needing a full page reload. `.load()` resets the
  // element's readyState/networkState and re-requests the src from scratch,
  // giving the browser another chance to successfully locate the file's
  // metadata.
  function retryLoad() {
    const video = videoRef.current;
    if (!video) return;
    resumeAttemptedRef.current = false;
    setVideoStuck(false);
    setBuffering(true);
    video.load();
  }

  // --- Keyboard shortcuts ---
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          seekBy(-SEEK_STEP_SECONDS);
          break;
        case "ArrowRight":
          seekBy(SEEK_STEP_SECONDS);
          break;
        case "ArrowUp":
          e.preventDefault();
          changeVolume(Math.min((videoRef.current?.volume ?? 1) + 0.1, 1));
          break;
        case "ArrowDown":
          e.preventDefault();
          changeVolume(Math.max((videoRef.current?.volume ?? 1) - 0.1, 0));
          break;
        case "m":
          toggleMute();
          break;
        case "f":
          void toggleFullscreen();
          break;
        case "c":
          handleCaptionsButtonClick();
          break;
        default:
          break;
      }
      handleActivity();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Double-click (desktop) / double-tap (mobile) to skip ---
  // A single click/tap on either half toggles play/pause, matching the
  // rest of the video area. A second click/tap on the SAME half within
  // DOUBLE_TAP_MS skips ±10s instead — this works identically for mouse
  // clicks and touch taps since both fire ordinary "click" events.
  function handleTapZone(zone: "left" | "right") {
    const now = Date.now();
    const last = lastTapRef.current;
    if (last && last.zone === zone && now - last.time < DOUBLE_TAP_MS) {
      seekBy(zone === "left" ? -SKIP_SECONDS : SKIP_SECONDS);
      setSkipPulse({ side: zone, nonce: now });
      lastTapRef.current = null;
    } else {
      lastTapRef.current = { zone, time: now };
      togglePlay();
    }
    handleActivity();
  }

  const showUpNext =
    !!nextEpisode &&
    !upNextDismissed &&
    duration > 0 &&
    (duration - currentTime <= UP_NEXT_THRESHOLD_SECONDS || ended);

  return (
    <div
      ref={containerRef}
      className="relative aspect-video w-full overflow-hidden bg-black"
      onMouseMove={handleActivity}
      onTouchStart={handleActivity}
      onMouseLeave={() => {
        // Only while actually playing — paused controls stay pinned
        // regardless of where the cursor is (handled by onPause above).
        if (!playing) return;
        if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
        setShowControls(false);
      }}
    >
      <video ref={videoRef} src={videoUrl} className="h-full w-full" playsInline />

      {/* Click/tap zones — single click toggles play/pause, a second
          click/tap on the same side within DOUBLE_TAP_MS skips ±10s.
          Covers the full player on every screen size (desktop mouse
          clicks and mobile taps both go through handleTapZone). Sits
          above the video and below the control bar, which is later in
          the DOM and paints on top so its own buttons stay clickable. */}
      <div className="absolute inset-0 flex">
        <button
          aria-label="Play/pause, or double-click to rewind 10 seconds"
          className="flex-1 outline-none focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-[#FF5FA2]/70"
          style={{ WebkitTapHighlightColor: "transparent" }}
          onClick={() => handleTapZone("left")}
        />
        <button
          aria-label="Play/pause, or double-click to forward 10 seconds"
          className="flex-1 outline-none focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-[#FF5FA2]/70"
          style={{ WebkitTapHighlightColor: "transparent" }}
          onClick={() => handleTapZone("right")}
        />
      </div>

      {skipPulse && (
        <div
          key={skipPulse.nonce}
          className={`pointer-events-none absolute top-1/2 z-10 flex -translate-y-1/2 flex-col items-center gap-1 rounded-full bg-black/60 px-5 py-4 text-white animate-[skipPulse_0.55s_ease-out] ${
            skipPulse.side === "left" ? "left-8" : "right-8"
          }`}
        >
          {skipPulse.side === "left" ? <BackIcon /> : <ForwardIcon />}
          <span className="text-xs">10s</span>
        </div>
      )}

      {centerPulse && (
        <div
          key={centerPulse.nonce}
          className="pointer-events-none absolute left-1/2 top-1/2 z-10 flex h-24 w-24 items-center justify-center rounded-full bg-black/55 text-white animate-[centerPulse_0.7s_ease-out]"
        >
          {centerPulse.icon === "play" ? <BigPlayIcon /> : <BigPauseIcon />}
        </div>
      )}

      <SubtitleOverlay cues={cues} currentTime={currentTime} settings={subtitleSettings} />

      {videoStuck && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 px-6 text-center">
          <p className="text-sm text-white/80">This is taking longer than expected to load.</p>
          <button
            onClick={retryLoad}
            className="rounded-lg bg-[#FF5FA2] px-4 py-2 text-sm font-medium text-[#0b0b12] hover:bg-[#FF5FA2]/90"
          >
            Retry
          </button>
        </div>
      )}

      {buffering && !videoStuck && !error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-12 w-12 animate-spin rounded-full border-2 border-white/20 border-t-[#FF5FA2]" />
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 px-6 text-center">
          <p className="text-white/90">{error}</p>
          <a href={backHref} className="text-sm text-[#C9A6FF] underline">
            Back to details
          </a>
        </div>
      )}

      {showUpNext && nextEpisode && (
        <div className="absolute bottom-24 right-6 z-20 flex items-center gap-3 rounded-xl border border-white/10 bg-[#0b0b12]/95 p-3 shadow-2xl">
          <div className="text-sm">
            <p className="text-white/50">Up next</p>
            <p className="text-white/90">{nextEpisode.label}</p>
          </div>
          <a
            href={nextEpisode.href}
            className="rounded-lg bg-[#FF5FA2] px-3 py-1.5 text-sm font-medium text-[#0b0b12] hover:bg-[#FF5FA2]/90"
          >
            Play
          </a>
          <button
            aria-label="Dismiss"
            onClick={() => setUpNextDismissed(true)}
            className="text-white/40 hover:text-white/70"
          >
            ✕
          </button>
        </div>
      )}

      {ended && !nextEpisode && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70">
          <button
            onClick={replay}
            className="rounded-xl bg-[#FF5FA2] px-6 py-3 font-medium text-[#0b0b12] hover:bg-[#FF5FA2]/90"
          >
            Watch Again
          </button>
        </div>
      )}

      {/* Control bar */}
      <div
        className={`absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/90 to-transparent px-4 pb-2 pt-7 transition-opacity duration-200 ${
          showControls ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <div
          className="group/scrub relative mb-1.5 flex h-4 w-full cursor-pointer items-center"
          role="slider"
          tabIndex={0}
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={duration || 0}
          aria-valuenow={currentTime}
          aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
          onMouseEnter={() => setScrubHover(true)}
          onMouseLeave={() => setScrubHover(false)}
          onMouseDown={(e) => {
            setScrubDragging(true);
            seekTo(scrubPositionToTime(e.clientX));
          }}
          onTouchStart={(e) => {
            setScrubDragging(true);
            if (e.touches[0]) seekTo(scrubPositionToTime(e.touches[0].clientX));
          }}
        >
          <div
            ref={scrubTrackRef}
            className={`relative w-full rounded-full bg-white/25 transition-all duration-150 ease-out ${
              scrubHover || scrubDragging ? "h-[5px]" : "h-[3px]"
            }`}
          >
            <div
              className="absolute left-0 top-0 h-full rounded-full bg-white/35"
              style={{ width: `${duration ? (Math.min(bufferedEnd, duration) / duration) * 100 : 0}%` }}
            />
            <div
              className="absolute left-0 top-0 h-full rounded-full bg-[#FF5FA2]"
              style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
            >
              <div
                className={`absolute top-1/2 rounded-full bg-[#FF5FA2] shadow-[0_0_2px_rgba(0,0,0,0.6)] transition-all duration-150 ease-out ${
                  scrubHover || scrubDragging ? "h-4 w-4" : "h-[13px] w-[13px]"
                }`}
                style={{ right: scrubHover || scrubDragging ? "-8px" : "-6.5px", transform: "translateY(-50%)" }}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-white">
          <button
            aria-label="Play/Pause"
            onClick={togglePlay}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 transition-colors hover:bg-white/25"
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>

          {(prevEpisode || nextEpisode) && (
            <div className="flex items-center gap-0.5 rounded-full bg-white/15 p-1">
              {prevEpisode && (
                <a
                  href={prevEpisode.href}
                  aria-label="Previous episode"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/20 hover:text-white"
                >
                  <PrevIcon />
                </a>
              )}
              {nextEpisode && (
                <a
                  href={nextEpisode.href}
                  aria-label="Next episode"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/20 hover:text-white"
                >
                  <NextIcon />
                </a>
              )}
            </div>
          )}

          <div className="player-volume-group flex h-10 items-center rounded-full bg-white/15 pl-1 pr-2">
            <button
              aria-label="Mute/unmute"
              onClick={toggleMute}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/20"
            >
              {muted || volume === 0 ? <MuteIcon /> : <VolumeIcon />}
            </button>
            <div className="player-volume-wrap flex items-center overflow-hidden">
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(e) => changeVolume(Number(e.target.value))}
                className="w-20 accent-[#FF5FA2]"
                aria-label="Volume"
              />
            </div>
          </div>

          <div className="flex h-10 items-center whitespace-nowrap rounded-full bg-white/15 px-3.5 text-sm font-medium tabular-nums text-white">
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>

          <div className="ml-auto flex items-center gap-1 rounded-full bg-white/15 px-1.5 py-1" ref={settingsRef}>
            <button
              aria-label={selectedLanguage ? "Turn off subtitles" : "Turn on subtitles"}
              aria-pressed={!!selectedLanguage}
              onClick={handleCaptionsButtonClick}
              className="flex h-8 w-8 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/20 hover:text-white"
            >
              <CCIcon active={!!selectedLanguage} />
            </button>

            <div className="relative">
              <button
                aria-label="Settings"
                onClick={() => setSettingsMenu((v) => (v ? null : "root"))}
                className="flex h-8 w-8 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/20 hover:text-white"
              >
                <GearIcon />
              </button>

              {settingsMenu === "root" && (
                <div className="absolute bottom-full right-0 mb-2 w-56 overflow-hidden rounded-xl border border-white/10 bg-[#0b0b12]/95 py-1 shadow-2xl backdrop-blur">
                  <button
                    onClick={() => setSettingsMenu("speed")}
                    className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm text-white/90 hover:bg-white/10"
                  >
                    <span>Playback speed</span>
                    <span className="text-white/50">{playbackRate === 1 ? "Normal" : `${playbackRate}x`}</span>
                  </button>
                  <button
                    onClick={() => setSettingsMenu("subtitles")}
                    className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm text-white/90 hover:bg-white/10"
                  >
                    <span>Subtitles</span>
                    <span className="text-white/50">
                      {selectedLanguage
                        ? (allTracks.find((t) => t.language === selectedLanguage)?.label ?? selectedLanguage)
                        : "Off"}
                    </span>
                  </button>
                </div>
              )}

              {settingsMenu === "speed" && (
                <div className="absolute bottom-full right-0 mb-2 w-48 overflow-hidden rounded-xl border border-white/10 bg-[#0b0b12]/95 py-1 shadow-2xl backdrop-blur">
                  <button
                    onClick={() => setSettingsMenu("root")}
                    className="flex w-full items-center gap-2 border-b border-white/10 px-3 py-2.5 text-left text-sm text-white/90 hover:bg-white/10"
                  >
                    <BackChevronIcon />
                    Playback speed
                  </button>
                  {SPEED_OPTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        changeRate(s);
                        setSettingsMenu("root");
                      }}
                      className={`block w-full px-3 py-2 text-left text-sm hover:bg-white/10 ${
                        s === playbackRate ? "text-[#FF5FA2]" : "text-white/90"
                      }`}
                    >
                      {s === 1 ? "Normal" : `${s}x`}
                    </button>
                  ))}
                </div>
              )}

              {settingsMenu === "subtitles" && (
                <div className="absolute bottom-full right-0 mb-2 flex flex-col items-end gap-1">
                  <button
                    onClick={() => setSettingsMenu("root")}
                    className="flex w-56 items-center gap-2 rounded-xl border border-white/10 bg-[#0b0b12]/95 px-3 py-2.5 text-left text-sm text-white/90 shadow-2xl backdrop-blur hover:bg-white/10"
                  >
                    <BackChevronIcon />
                    Subtitles
                  </button>
                  <SubtitleSettingsPanel
                    tracks={allTracks}
                    selectedLanguage={selectedLanguage}
                    onSelectLanguage={setSelectedLanguage}
                    settings={subtitleSettings}
                    onChange={updateSubtitleSettings}
                    identity={identity}
                    onTrackAdded={(track) => {
                      setOnlineTracks((prev) => [...prev.filter((t) => t.url !== track.url), track]);
                      setSelectedLanguage(track.language);
                    }}
                  />
                </div>
              )}
            </div>

            <button
              aria-label="Fullscreen"
              onClick={toggleFullscreen}
              className="flex h-8 w-8 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/20 hover:text-white"
            >
              {fullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Icons (small inline SVGs, matching the rest of the app's convention) ---

function PlayIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
    </svg>
  );
}
// Bigger versions for the center-of-screen confirmation bubble.
function BigPlayIcon() {
  return (
    <svg width="52" height="52" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
function BigPauseIcon() {
  return (
    <svg width="52" height="52" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
    </svg>
  );
}
function BackIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 12a9 9 0 1 0 3-6.7" strokeLinecap="round" />
      <path d="M3 4v5h5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ForwardIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M21 12a9 9 0 1 1-3-6.7" strokeLinecap="round" />
      <path d="M21 4v5h-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function PrevIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 6h2v12H6zM20 6v12l-10-6z" />
    </svg>
  );
}
function NextIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16 6h2v12h-2zM4 6v12l10-6z" />
    </svg>
  );
}
function VolumeIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <path d="M4 9v6h4l5 5V4L8 9H4z" />
      <path
        d="M16.5 8.5a5 5 0 0 1 0 7"
        stroke="currentColor"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
function MuteIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <path d="M4 9v6h4l5 5V4L8 9H4z" />
      <path d="M17 9l4 6M21 9l-4 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function FullscreenIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function FullscreenExitIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
// Standard "closed captions" glyph (a single filled outline, no embedded
// text/font rendering — the old version drew literal "CC" letters with an
// <svg><text>, which looks inconsistent across platforms since it depends
// on whatever fallback font the browser picks for SVG text).
function CCIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill={active ? "#FF5FA2" : "currentColor"}
    >
      <path d="M19 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1z" />
    </svg>
  );
}
// Standard filled cog/gear glyph, replacing the old dashed-circle
// approximation of gear teeth.
function GearIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
    </svg>
  );
}
function BackChevronIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
