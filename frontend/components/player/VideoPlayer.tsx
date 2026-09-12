"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { getStaticOrigin } from "@/lib/api-client";
import type { PlaybackSource } from "@/lib/playback";
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
  const [buffering, setBuffering] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
    const track = source.subtitles.find((t) => t.language === selectedLanguage);
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
  }, [selectedLanguage, source.subtitles]);

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
    function attemptResume() {
      if (resumeAttemptedRef.current || !video) return;
      if (!Number.isFinite(video.duration) || video.duration <= 0) return;
      const resume = source.resume_position_seconds;
      if (resume && resume > 3 && resume < video.duration - 5) {
        video.currentTime = resume;
      }
      resumeAttemptedRef.current = true;
      setProgressRestored(true);
    }

    const resumeFallbackTimer = setTimeout(() => {
      if (!resumeAttemptedRef.current) {
        resumeAttemptedRef.current = true;
        setProgressRestored(true);
      }
    }, 8000);

    function onLoadedMetadata() {
      if (!video) return;
      setDuration(video.duration);
      attemptResume();
      setBuffering(false);
    }
    function onDurationChange() {
      if (!video) return;
      setDuration(video.duration);
      attemptResume();
    }
    function onTimeUpdate() {
      if (video) setCurrentTime(video.currentTime);
    }
    function onPlay() {
      setPlaying(true);
      setEnded(false);
    }
    function onPause() {
      setPlaying(false);
    }
    function onWaiting() {
      setBuffering(true);
    }
    function onCanPlay() {
      setBuffering(false);
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
      setBuffering(false);
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
      setError("This video couldn't be played. Try refreshing the page.");
      setBuffering(false);
    }
    function onEnded() {
      setEnded(true);
      setPlaying(false);
    }

    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("durationchange", onDurationChange);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("volumechange", onVolumeChange);
    video.addEventListener("ratechange", onRateChange);
    video.addEventListener("error", onError);
    video.addEventListener("ended", onEnded);


    return () => {
      clearTimeout(resumeFallbackTimer);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("durationchange", onDurationChange);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("volumechange", onVolumeChange);
      video.removeEventListener("ratechange", onRateChange);
      video.removeEventListener("error", onError);
      video.removeEventListener("ended", onEnded);
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

  // --- Controls ---
  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
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
  function toggleCaptions() {
    if (selectedLanguageRef.current) {
      setSelectedLanguage(null);
    } else {
      setSelectedLanguage(lastSubtitleLanguageRef.current ?? source.subtitles[0]?.language ?? null);
    }
  }

  function replay() {
    seekTo(0);
    void videoRef.current?.play();
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
          if (source.subtitles.length > 0) toggleCaptions();
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

      <SubtitleOverlay cues={cues} currentTime={currentTime} settings={subtitleSettings} />

      {buffering && !error && (
        <div className="absolute inset-0 flex items-center justify-center">
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
        className={`absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/90 to-transparent px-4 pb-3 pt-10 transition-opacity duration-200 ${
          showControls ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <div className="mb-2 flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            onChange={(e) => seekTo(Number(e.target.value))}
            className="w-full accent-[#FF5FA2]"
            aria-label="Seek"
          />
        </div>

        <div className="flex items-center gap-3 text-white">
          <button aria-label="Play/Pause" onClick={togglePlay}>
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          {prevEpisode && (
            <a href={prevEpisode.href} aria-label="Previous episode" className="text-white/70 hover:text-white">
              <PrevIcon />
            </a>
          )}
          {nextEpisode && (
            <a href={nextEpisode.href} aria-label="Next episode" className="text-white/70 hover:text-white">
              <NextIcon />
            </a>
          )}

          <div className="flex items-center gap-1.5">
            <button aria-label="Mute/unmute" onClick={toggleMute}>
              {muted || volume === 0 ? <MuteIcon /> : <VolumeIcon />}
            </button>
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

          <span className="text-xs tabular-nums text-white/70">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

          <div className="ml-auto flex items-center gap-4" ref={settingsRef}>
            {source.subtitles.length > 0 && (
              <button
                aria-label={selectedLanguage ? "Turn off subtitles" : "Turn on subtitles"}
                aria-pressed={!!selectedLanguage}
                onClick={toggleCaptions}
                className="text-white/90 hover:text-white"
              >
                <CCIcon active={!!selectedLanguage} />
              </button>
            )}

            <div className="relative">
              <button
                aria-label="Settings"
                onClick={() => setSettingsMenu((v) => (v ? null : "root"))}
                className="text-white/90 hover:text-white"
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
                  {source.subtitles.length > 0 && (
                    <button
                      onClick={() => setSettingsMenu("subtitles")}
                      className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm text-white/90 hover:bg-white/10"
                    >
                      <span>Subtitles</span>
                      <span className="text-white/50">
                        {selectedLanguage
                          ? (source.subtitles.find((t) => t.language === selectedLanguage)?.label ?? selectedLanguage)
                          : "Off"}
                      </span>
                    </button>
                  )}
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
                    tracks={source.subtitles}
                    selectedLanguage={selectedLanguage}
                    onSelectLanguage={setSelectedLanguage}
                    settings={subtitleSettings}
                    onChange={updateSubtitleSettings}
                  />
                </div>
              )}
            </div>

            <button aria-label="Fullscreen" onClick={toggleFullscreen} className="text-white/90 hover:text-white">
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
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
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
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 6h2v12H6zM20 6v12l-10-6z" />
    </svg>
  );
}
function NextIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16 6h2v12h-2zM4 6v12l10-6z" />
    </svg>
  );
}
function VolumeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M4 9v6h4l5 5V4L8 9H4z" />
      <path
        d="M16.5 8.5a5 5 0 0 1 0 7"
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
function MuteIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M4 9v6h4l5 5V4L8 9H4z" />
      <path d="M17 9l4 6M21 9l-4 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function FullscreenIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function FullscreenExitIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function CCIcon({ active }: { active: boolean }) {
  return (
    <svg width="26" height="18" viewBox="0 0 26 18" fill="none">
      <rect
        x="0.75"
        y="0.75"
        width="24.5"
        height="16.5"
        rx="2.5"
        stroke="currentColor"
        strokeWidth={active ? 0 : 1.6}
        fill={active ? "currentColor" : "none"}
      />
      <text
        x="13"
        y="12.7"
        textAnchor="middle"
        fontSize="8"
        fontWeight="700"
        fontFamily="Arial, Helvetica, sans-serif"
        fill={active ? "#0b0b12" : "currentColor"}
      >
        CC
      </text>
    </svg>
  );
}
function GearIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="2.8" />
      <circle cx="12" cy="12" r="7.5" strokeDasharray="2.1 2.4" strokeLinecap="round" />
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
