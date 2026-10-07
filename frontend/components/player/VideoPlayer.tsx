"use client";

import { useEffect, useRef, useState, useCallback, useMemo, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { getStaticOrigin } from "@/lib/api-client";
import type { PlaybackSource, SubtitleTrack } from "@/lib/playback";
import { searchOnlineSubtitles, downloadOnlineSubtitle, navigateWithResumeHint, patchVideoSettings, getSegments } from "@/lib/playback";
import { consumeAutoplayFlag, flagAutoplayNext } from "@/lib/autoplay";
import { resolveInitialSubtitle } from "@/components/player/subtitle-preference";
import { useAutoNext } from "@/components/player/useAutoNext";
import { usePresence } from "@/components/player/usePresence";
import { useWatchProgress, type WatchIdentity } from "@/components/player/useWatchProgress";
import { parseSubtitles, type Cue } from "@/components/player/subtitle-utils";
import {
  fromGlobalStyle,
  stylePatch,
  type SubtitleSettings,
} from "@/components/player/subtitle-settings";
import { loadPlayerPreferences, savePlayerPreferences } from "@/components/player/player-preferences";
import { activeSkip, autoSkipTarget, SKIP_LABELS, type SegmentsData } from "@/components/player/skip-segments";
import SubtitleOverlay from "@/components/player/SubtitleOverlay";
import Flag from "@/components/player/Flag";
import SubtitleSettingsPanel from "@/components/player/SubtitleSettingsPanel";
import PlayerTooltip from "@/components/player/PlayerTooltip";
import HoldSpeedIndicator from "@/components/player/HoldSpeedIndicator";
import { useHoldSpeed } from "@/components/player/useHoldSpeed";
import { useSettings } from "@/components/SettingsProvider";
import {
  PlayIcon,
  PauseIcon,
  BigPlayIcon,
  BigPauseIcon,
  BackIcon,
  ForwardIcon,
  PrevIcon,
  NextIcon,
  VolumeLowIcon,
  VolumeHighIcon,
  MuteIcon,
  FullscreenIcon,
  FullscreenExitIcon,
  CCIcon,
  GearIcon,
  PipIcon,
  BackChevronIcon,
} from "@/components/player/icons";

const AUTO_HIDE_MS = 3000;
const UP_NEXT_THRESHOLD_SECONDS = 20;
const DOUBLE_TAP_MS = 300;
const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const SLEEP_TIMER_OPTIONS = [15, 30, 45, 60]; // minutes
const SLEEP_TIMER_STORAGE_KEY = "candyflix:sleep-timer-ends-at";

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
  // Every track offered so far (the video's own, synced ones, and ones picked this session),
  // each once, for the Source / Synced tabs of the subtitle menu.
  const listedTracks = useMemo(() => {
    const seen = new Set<string>();
    return [...source.subtitles, ...onlineTracks].filter((t) => !seen.has(t.url) && !!seen.add(t.url));
  }, [source.subtitles, onlineTracks]);
  // What plays is one track per language. The latest pick wins (so choosing another
  // release, or finishing a sync, takes over); a synced track kept from an earlier visit
  // beats the unsynced one that came with the page.
  const allTracks = useMemo(() => {
    const ordered = [
      ...source.subtitles.filter((t) => !t.synced),
      ...source.subtitles.filter((t) => t.synced),
      ...onlineTracks,
    ];
    const byLanguage = new Map<string, SubtitleTrack>();
    for (const t of ordered) byLanguage.set(t.language, t);
    return [...byLanguage.values()];
  }, [source.subtitles, onlineTracks]);
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
  // Sleep timer: a real wall-clock countdown (not tied to playback time —
  // it keeps counting down even while paused, matching how this feature
  // works in basically every other player), stored as an absolute
  // timestamp in sessionStorage rather than component state alone. That's
  // what lets it survive clicking "next episode" mid-countdown, which is
  // a full page navigation (a new VideoPlayer instance entirely) — the
  // actual point of a sleep timer while binge-watching is "stop playback
  // once I'm actually asleep," not "stop at the end of whichever episode
  // happened to be on when I set it." sessionStorage specifically (not
  // localStorage) so a timer never lingers into some unrelated future
  // viewing session after the tab's been closed.
  const [sleepTimerMinutes, setSleepTimerMinutes] = useState<number | null>(null);
  const [sleepTimerEndsAt, setSleepTimerEndsAt] = useState<number | null>(null);
  const [sleepTimerRemainingLabel, setSleepTimerRemainingLabel] = useState<string | null>(null);
  const [sleepTimerFired, setSleepTimerFired] = useState(false);
  const sleepTimerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showControls, setShowControls] = useState(true);
  // Single gear menu, YouTube-style: root list -> drill into "speed" or
  // "subtitles" -> back arrow returns to root. Replaces the old separate
  // speed-menu/subtitle-settings toggles now that both live behind one gear.
  const [settingsMenu, setSettingsMenu] = useState<"root" | "speed" | "subtitles" | "sleepTimer" | null>(
    null
  );
  // Desktop has plenty of room above the control bar, so opening upward
  // (anchored to the bottom of the trigger) is the right default there.
  // On a short phone viewport, upward can push the (especially tall)
  // subtitles panel off the top of the screen entirely — so this is
  // recomputed against actual available space every time a menu opens.
  const [settingsMenuDirection, setSettingsMenuDirection] = useState<"up" | "down">("up");
  const [settingsMenuMaxHeight, setSettingsMenuMaxHeight] = useState(400);

  // NOTE: this always starts at null/off, even though a persisted
  // language preference might exist — see the mount-only correction
  // effect below (after the main video-setup effect) for why it can't
  // just be computed from localStorage here. Reading localStorage inside
  // this initializer diverges between the server-rendered HTML (which
  // has no localStorage) and the client's first hydration pass (which
  // does), which is exactly the "server/client attribute mismatch"
  // hydration error this used to cause on the CC button.
  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null);
  const selectedLanguageRef = useRef<string | null>(null);
  const lastSubtitleLanguageRef = useRef<string | null>(null);
  const [cues, setCues] = useState<Cue[]>([]);
  const { settings: allSettings, update: updateSettings } = useSettings();
  const globalSubtitles = allSettings.subtitles;
  // Timing belongs to this video; the look comes from the site-wide settings.
  const [subtitleOffset, setSubtitleOffset] = useState(0);
  const subtitleSettings = useMemo<SubtitleSettings>(
    () => ({ ...fromGlobalStyle(globalSubtitles), offsetSeconds: subtitleOffset }),
    [globalSubtitles, subtitleOffset]
  );

  const [upNextDismissed, setUpNextDismissed] = useState(false);
  const [ended, setEnded] = useState(false);
  const [skipPulse, setSkipPulse] = useState<{ side: "left" | "right"; nonce: number } | null>(null);
  const [centerPulse, setCenterPulse] = useState<{ icon: "play" | "pause"; nonce: number } | null>(null);

  // Becomes true once we've either applied the saved resume position or
  // decided there's nothing to resume. useWatchProgress doesn't attach any
  // save-triggering listeners until this flips — see its file header for why.
  const [progressRestored, setProgressRestored] = useState(false);
  const resumeAttemptedRef = useRef(false);
  const autoplayHandledRef = useRef(false);
  const volumeSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Settings -> Playback. The ref lets the long-lived video listeners below
  // read the current values without being torn down and re-attached.
  const playbackSettings = useSettings().settings.playback;
  const playbackSettingsRef = useRef(playbackSettings);
  playbackSettingsRef.current = playbackSettings;

  useWatchProgress(videoRef, identity, progressRestored, playbackSettings.save_progress);
  usePresence(videoRef, identity);

  // Autoplay next episode: once a video has ENDED and there is a next
  // episode, count down 5 s and go (Cancel / Play now on the card below).
  // `ended` resets on play, so seeking back or replaying cancels it, and a
  // fired sleep timer stops the chain.
  const autoNextWanted =
    !!nextEpisode && playbackSettings.autoplay_next && ended && !upNextDismissed && !sleepTimerFired;
  const autoNextRemaining = useAutoNext(autoNextWanted, () => {
    if (!nextEpisode) return;
    flagAutoplayNext();
    navigateWithResumeHint(identity, nextEpisode.href, playbackSettingsRef.current.save_progress);
  });

  // Press-and-hold speed control (touch / mouse on the video surface, or
  // the Space bar). See hold-speed.ts for the behaviour.
  const hold = useHoldSpeed(videoRef);

  // One setting (Settings → Playback → Seek time) drives the arrow keys,
  // J / L and the double-tap zones. Read fresh each render, so a change
  // made in another tab/page applies without reloading the player.
  const seekSeconds = playbackSettings.seek_seconds;
  const controls = playbackSettings.controls;
  // Picture-in-picture only where the browser can do it.
  const [pipSupported, setPipSupported] = useState(false);
  useEffect(() => {
    setPipSupported(typeof document !== "undefined" && !!document.pictureInPictureEnabled);
  }, []);

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

  // Look changes (colour, size, font…) are saved to the site-wide settings, so
  // they apply to every video. Timing is saved for this video only (when
  // "Remember settings per video" is on; otherwise it lasts until you leave).
  const subtitleSettingsRef = useRef(subtitleSettings);
  subtitleSettingsRef.current = subtitleSettings;

  function updateSubtitleSettings(next: SubtitleSettings) {
    const prev = subtitleSettingsRef.current;
    const style = stylePatch(prev, next);
    if (Object.keys(style).length > 0) void updateSettings({ subtitles: style });
    if (next.offsetSeconds !== prev.offsetSeconds) {
      setSubtitleOffset(next.offsetSeconds);
      if (playbackSettingsRef.current.remember_per_video) {
        patchVideoSettings(identity, { subtitle_offset: next.offsetSeconds });
      }
    }
  }

  // --- Video element event wiring ---
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Syncs the video element's volume/mute to whatever React state
    // currently holds — on the very first mount that's just the plain
    // defaults (1/false), since it's not safe to compute the real
    // persisted values here (see the mount-only effect declared right
    // after this one, which applies + corrects them post-hydration).
    // On every subsequent run of this effect (i.e. loading a new video),
    // this correctly carries forward whatever volume/mute was already in
    // effect for the previous video.
    video.volume = volume;
    video.muted = muted;

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
      // "Save watch progress" off: nothing was saved, and nothing is resumed.
      if (playbackSettingsRef.current.save_progress && resume && resume > 3 && resume < video.duration - 5) {
        log("attemptResume: seeking to saved position", resume);
        video.currentTime = resume;
      } else {
        log("attemptResume: nothing to resume", { resume, duration: video.duration });
      }
      resumeAttemptedRef.current = true;
      setProgressRestored(true);
      maybeAutoplay();
    }

    // "Start playing when a video opens", or the previous episode's
    // autoplay handing over. A browser that refuses (autoplay policy) just
    // leaves the video paused, as it was before.
    function maybeAutoplay() {
      if (autoplayHandledRef.current || !video) return;
      autoplayHandledRef.current = true;
      const handedOver = consumeAutoplayFlag();
      if (handedOver || playbackSettingsRef.current.autoplay_on_open) void video.play().catch(() => {});
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

  // Applies remembered volume/mute/subtitle-language *after* hydration,
  // rather than as each state's initial value — see the comments on
  // those useState calls above for why. Declared textually after the
  // main video-setup effect above (both plain useEffects, same
  // dependency-less "mount" timing) specifically so this one runs
  // second: that effect's own `video.volume = volume` / `video.muted =
  // muted` (using the pre-correction default state from the very first
  // render) would otherwise stomp the real values this sets on the
  // video element right back to the defaults.
  useEffect(() => {
    const persisted = loadPlayerPreferences();
    const { remember_per_video, auto_subtitles } = playbackSettingsRef.current;
    // This video's own saved tweaks win over the "last used" ones, but only
    // while "Remember settings per video" is on.
    const perVideo = remember_per_video ? source.video_settings ?? {} : {};

    setSubtitleOffset(typeof perVideo.subtitle_offset === "number" && Number.isFinite(perVideo.subtitle_offset) ? perVideo.subtitle_offset : 0);

    const volume = perVideo.volume ?? persisted.volume;
    const muted = perVideo.muted ?? persisted.muted;
    const video = videoRef.current;
    if (video) {
      video.volume = volume;
      video.muted = muted;
    }
    setVolume(volume);
    setMuted(muted);

    const initial = resolveInitialSubtitle({
      perVideo: perVideo.subtitle_language,
      rememberPerVideo: remember_per_video,
      auto: auto_subtitles,
    });
    if (initial.kind === "off") return;

    function select(language: string) {
      setSelectedLanguage(language);
      selectedLanguageRef.current = language;
      lastSubtitleLanguageRef.current = language;
    }

    const alreadyAvailable = initial.languages.find((l) => source.subtitles.some((t) => t.language === l));
    if (alreadyAvailable) {
      select(alreadyAvailable);
      return;
    }

    // None of the wanted languages is one of this title's baked-in default
    // tracks — source.subtitles only ever contains the auto-fetched
    // English default (see subtitle_service.py) — so fetch it fresh for
    // this specific title, exactly like picking it from the search box
    // would, trying the preferred language first and then the fallback.
    // Failing silently (no results, network hiccup) just means this title
    // starts with captions off, consistent with how every other subtitle
    // fetch in this player degrades.
    let cancelled = false;
    (async () => {
      for (const language of initial.languages) {
        try {
          const { results } = await searchOnlineSubtitles({
            mediaType: identity.mediaType,
            tmdbId: identity.tmdbId,
            seasonNumber: identity.seasonNumber,
            episodeNumber: identity.episodeNumber,
            language,
          });
          if (cancelled) return;
          if (results.length === 0) continue;
          const best = results[0]; // already sorted most-downloaded first
          const track = await downloadOnlineSubtitle({
            mediaType: identity.mediaType,
            tmdbId: identity.tmdbId,
            seasonNumber: identity.seasonNumber,
            episodeNumber: identity.episodeNumber,
            fileId: best.file_id,
            language: best.language,
            label: best.label,
          });
          if (cancelled) return;
          setOnlineTracks((prev) => [...prev.filter((t) => t.url !== track.url), track]);
          select(track.language);
          return;
        } catch {
          // Try the next language.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Mount-only — this is a one-time restoration for this player
    // instance, not something that should re-run on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      const target = e.target as Node;
      const insideTrigger = settingsRef.current?.contains(target);
      const insidePortal = settingsPortalRef.current?.contains(target);
      if (!insideTrigger && !insidePortal) {
        setSettingsMenu(null);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [settingsMenu]);

  // The settings dropdown is rendered via a portal straight into
  // document.body (see settingsPortalRef below), not as a DOM child of
  // the player. Necessary because the player's own container is
  // `overflow-hidden` (it clips the video to a rounded box) and sized by
  // `aspect-video` — on a small phone player that's a genuinely short
  // box, so anything positioned inside it that needs more room than
  // that box has (like the subtitles panel) was being clipped away
  // entirely, not just cut off. Fullscreen happened to mask this, since
  // the container expands to fill the whole screen there. A portal
  // escapes that ancestor's overflow/size constraints outright, so the
  // fix holds in both fullscreen and the small inline player.
  const [settingsAnchor, setSettingsAnchor] = useState<{ top: number; bottom: number; right: number } | null>(
    null
  );
  const settingsPortalRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (settingsMenu === null || !settingsRef.current) return;
    function recompute() {
      if (!settingsRef.current) return;
      // The subtitles panel (live preview + full styling controls) is far
      // taller than the plain root/speed lists, so each needs its own
      // rough height estimate rather than one shared threshold when
      // deciding which DIRECTION to open in.
      const estimatedHeight = settingsMenu === "subtitles" ? 480 : 220;
      const rect = settingsRef.current.getBoundingClientRect();
      const spaceAbove = rect.top;
      const spaceBelow = window.innerHeight - rect.bottom;
      const direction = spaceAbove >= estimatedHeight || spaceAbove >= spaceBelow ? "up" : "down";
      setSettingsMenuDirection(direction);
      // The actual cap on how tall the panel's allowed to render: real
      // available space in whichever direction was picked, minus a small
      // margin — NOT a flat vh guess. A flat "85% of the viewport"
      // assumes the panel can use nearly the whole screen, which stops
      // being true the moment something else (the site header, in this
      // case) already occupies part of that viewport — the panel would
      // still open in the "correct" direction but overflow past the
      // actual visible remainder anyway.
      const available = direction === "up" ? spaceAbove : spaceBelow;
      setSettingsMenuMaxHeight(Math.max(120, available - 16));
      setSettingsAnchor({ top: rect.top, bottom: rect.bottom, right: window.innerWidth - rect.right });
    }
    recompute();
    window.addEventListener("resize", recompute);
    // Capture phase + passive: catches scrolling on the page itself or
    // any scrollable ancestor, without blocking the scroll. Necessary
    // once the page can scroll at all (e.g. with the site header now
    // present above the player) — the trigger button moves with the
    // page, but a position:fixed panel doesn't follow it on its own,
    // which otherwise looks like the panel has detached from the button
    // mid-scroll.
    window.addEventListener("scroll", recompute, { capture: true, passive: true });
    return () => {
      window.removeEventListener("resize", recompute);
      window.removeEventListener("scroll", recompute, { capture: true });
    };
  }, [settingsMenu, fullscreen]);

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

  // --- Skip intro / recap / credits (Phase 9f) ---
  // Looked up once the video's length is known (it helps match timestamps
  // to this exact file). Any failure just means "no skip buttons".
  const [segments, setSegments] = useState<SegmentsData | null>(null);
  const wantSkipData = playbackSettings.auto_skip_intro || Object.values(playbackSettings.skip_buttons).some(Boolean);
  const hasLength = Number.isFinite(duration) && duration > 0;
  useEffect(() => {
    if (!wantSkipData || !hasLength) return;
    let cancelled = false;
    getSegments(identity, duration)
      .then((data) => !cancelled && setSegments(data))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // `duration` is deliberately read once when it first becomes known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantSkipData, hasLength, identity.mediaType, identity.tmdbId, identity.seasonNumber, identity.episodeNumber]);

  const skipTarget = activeSkip(segments, currentTime, playbackSettings.skip_buttons);

  // Auto-skip: the intro only, once per video — rewinding into it later is left alone.
  const autoSkippedRef = useRef(false);
  useEffect(() => {
    const target = autoSkipTarget(segments, currentTime, playbackSettings.auto_skip_intro, autoSkippedRef.current);
    if (target === null) return;
    autoSkippedRef.current = true;
    seekTo(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, currentTime, playbackSettings.auto_skip_intro]);

  // When a skippable part begins, bring the controls up so the button is seen
  // (it fades away with them, like the rest of the controls).
  const skipKind = skipTarget?.kind ?? null;
  useEffect(() => {
    if (skipKind) handleActivity();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipKind]);

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
    savePlayerPreferences({ ...loadPlayerPreferences(), muted: video.muted });
    rememberForThisVideo({ muted: video.muted });
  }

  // "Remember settings per video": a change made here is kept for this
  // movie/episode only (the global "last used" copy above is what NEW
  // videos start from).
  function rememberForThisVideo(patch: Parameters<typeof patchVideoSettings>[1]) {
    if (!playbackSettingsRef.current.remember_per_video) return;
    patchVideoSettings(identity, patch);
  }

  function changeVolume(v: number) {
    const video = videoRef.current;
    if (!video) return;
    video.volume = v;
    video.muted = v === 0;
    savePlayerPreferences({ ...loadPlayerPreferences(), volume: v, muted: v === 0 });
    // Dragging the slider fires this many times a second; save once it settles.
    if (volumeSaveTimerRef.current) clearTimeout(volumeSaveTimerRef.current);
    volumeSaveTimerRef.current = setTimeout(() => rememberForThisVideo({ volume: v, muted: v === 0 }), 600);
  }

  function changeRate(rate: number) {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = rate;
  }

  function startSleepTimer(minutes: number | null) {
    if (sleepTimerTimeoutRef.current) clearTimeout(sleepTimerTimeoutRef.current);

    if (minutes === null) {
      setSleepTimerMinutes(null);
      setSleepTimerEndsAt(null);
      sessionStorage.removeItem(SLEEP_TIMER_STORAGE_KEY);
      return;
    }

    const endsAt = Date.now() + minutes * 60_000;
    setSleepTimerMinutes(minutes);
    setSleepTimerEndsAt(endsAt);
    sessionStorage.setItem(SLEEP_TIMER_STORAGE_KEY, String(endsAt));
    scheduleSleepTimerFire(endsAt);
  }

  function scheduleSleepTimerFire(endsAt: number) {
    if (sleepTimerTimeoutRef.current) clearTimeout(sleepTimerTimeoutRef.current);
    const msRemaining = endsAt - Date.now();
    sleepTimerTimeoutRef.current = setTimeout(
      () => {
        videoRef.current?.pause();
        setSleepTimerMinutes(null);
        setSleepTimerEndsAt(null);
        sessionStorage.removeItem(SLEEP_TIMER_STORAGE_KEY);
        setSleepTimerFired(true);
      },
      Math.max(0, msRemaining)
    );
  }

  function dismissSleepTimerDialog() {
    // Video's already paused (from the moment the timer fired) — just
    // closes the dialog, playback stays stopped until resumed by hand.
    setSleepTimerFired(false);
  }

  function addSleepTime(minutes: number) {
    setSleepTimerFired(false);
    startSleepTimer(minutes);
    if (videoRef.current?.paused) togglePlay();
  }

  // Resumes a sleep timer started on a previous episode, if one's still
  // running — this is what makes it survive clicking "next episode."
  // An already-expired stored value is just cleared silently rather than
  // retroactively pausing: if enough time has passed that sessionStorage
  // still has a stale entry, pausing now would be surprising rather than
  // useful.
  useEffect(() => {
    const stored = sessionStorage.getItem(SLEEP_TIMER_STORAGE_KEY);
    if (!stored) return;
    const endsAt = Number(stored);
    if (!Number.isFinite(endsAt) || endsAt <= Date.now()) {
      sessionStorage.removeItem(SLEEP_TIMER_STORAGE_KEY);
      return;
    }
    setSleepTimerMinutes(Math.round((endsAt - Date.now()) / 60_000));
    setSleepTimerEndsAt(endsAt);
    scheduleSleepTimerFire(endsAt);
    // Mount-only: this restores whatever was already running when this
    // player instance was created, not something that should re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (sleepTimerTimeoutRef.current) clearTimeout(sleepTimerTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (sleepTimerEndsAt === null) {
      setSleepTimerRemainingLabel(null);
      return;
    }
    function tick() {
      const msLeft = (sleepTimerEndsAt as number) - Date.now();
      const totalSeconds = Math.max(0, Math.ceil(msLeft / 1000));
      const m = Math.floor(totalSeconds / 60);
      const s = totalSeconds % 60;
      setSleepTimerRemainingLabel(`${m}:${s.toString().padStart(2, "0")}`);
    }
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [sleepTimerEndsAt]);

  async function togglePip() {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch {
      // Refused (another PiP window, a policy): nothing to do.
    }
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

  // The single place that changes selectedLanguage in response to an
  // actual user action (as opposed to the mount-time restoration effect,
  // which intentionally uses the raw setter — see its own comment for
  // why). Persisting here, at the point of explicit user intent, avoids
  // the fragile alternative of a generic "watch selectedLanguage, save on
  // any change" effect: that also fires once on every mount using
  // whatever value existed BEFORE the restoration effect has run (null),
  // which — depending on ordering — could silently overwrite a real
  // saved preference with "off" the moment a new video loads.
  function selectSubtitleLanguage(language: string | null) {
    setSelectedLanguage(language);
    rememberForThisVideo({ subtitle_language: language ?? "off" });
  }

  function toggleCaptions() {
    if (selectedLanguageRef.current) {
      selectSubtitleLanguage(null);
    } else {
      selectSubtitleLanguage(lastSubtitleLanguageRef.current ?? allTracks[0]?.language ?? null);
    }
  }

  function replay() {
    seekTo(0);
    void videoRef.current?.play();
  }

  // Used by the "Up next" Play button and the prev/next-episode controls
  // below — saves in the background and navigates immediately. See
  // navigateWithResumeHint's docstring in lib/playback.ts: the earlier
  // version of this awaited the save first, which was correct but made
  // every episode switch wait on a network round-trip — bad on a slow
  // connection. Passing what's playing forward as a URL hint gets the
  // same correctness without that cost.
  function handleEpisodeNavClick(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
    e.preventDefault();
    navigateWithResumeHint(identity, href, playbackSettingsRef.current.save_progress);
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
  // The handlers are plain functions redefined every render (so they
  // always see fresh state: current tracks, next/prev episode, ...) and
  // reached through a ref, so the window listeners below register once
  // instead of capturing whatever the first render saw.
  function isTypingTarget(e: KeyboardEvent): boolean {
    const tag = (e.target as HTMLElement)?.tagName;
    return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
  }

  function handleShortcutKeyDown(e: KeyboardEvent) {
    if (isTypingTarget(e)) return;
    // Leave browser/OS shortcuts alone (Ctrl+F, Cmd+C, Alt+Left, ...).
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    // Holding a key down auto-repeats; only seeking should repeat.
    const repeatable = key.startsWith("Arrow") || key === "j" || key === "l";
    if (e.repeat && !repeatable) {
      if (key === " ") e.preventDefault();
      return;
    }

    switch (key) {
      case " ":
        // Tap toggles play/pause (on release, see the keyup handler);
        // holding it is the 2x speed-up.
        e.preventDefault();
        hold.onSpaceDown();
        break;
      case "k":
        e.preventDefault();
        togglePlay();
        break;
      case "j":
        seekBy(-seekSeconds);
        setSkipPulse({ side: "left", nonce: Date.now() });
        break;
      case "l":
        seekBy(seekSeconds);
        setSkipPulse({ side: "right", nonce: Date.now() });
        break;
      case "ArrowLeft":
        seekBy(-seekSeconds);
        break;
      case "ArrowRight":
        seekBy(seekSeconds);
        break;
      case "ArrowUp":
        if (!controls.volume) break;
        e.preventDefault();
        changeVolume(Math.min((videoRef.current?.volume ?? 1) + 0.1, 1));
        break;
      case "ArrowDown":
        if (!controls.volume) break;
        e.preventDefault();
        changeVolume(Math.max((videoRef.current?.volume ?? 1) - 0.1, 0));
        break;
      case "m":
        if (controls.volume) toggleMute();
        break;
      case "f":
        if (controls.fullscreen) void toggleFullscreen();
        break;
      case "c":
        if (controls.captions) handleCaptionsButtonClick();
        break;
      case "s":
        setSettingsMenu((v) => (v ? null : "root"));
        break;
      case "n":
        if (controls.episodes && e.shiftKey && nextEpisode) navigateWithResumeHint(identity, nextEpisode.href, playbackSettingsRef.current.save_progress);
        break;
      case "p":
        if (e.shiftKey) {
          if (controls.episodes && prevEpisode) navigateWithResumeHint(identity, prevEpisode.href, playbackSettingsRef.current.save_progress);
        } else if (controls.pip && pipSupported) {
          void togglePip();
        }
        break;
      default:
        break;
    }
    handleActivity();
  }

  function handleShortcutKeyUp(e: KeyboardEvent) {
    if (e.key !== " " || isTypingTarget(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    // Also stops a focused button from "clicking" on Space release (Firefox).
    e.preventDefault();
    if (hold.onSpaceUp() === "tap") {
      togglePlay();
      handleActivity();
    }
  }

  const shortcutHandlersRef = useRef({ down: handleShortcutKeyDown, up: handleShortcutKeyUp });
  shortcutHandlersRef.current = { down: handleShortcutKeyDown, up: handleShortcutKeyUp };

  useEffect(() => {
    const down = (e: KeyboardEvent) => shortcutHandlersRef.current.down(e);
    const up = (e: KeyboardEvent) => shortcutHandlersRef.current.up(e);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // --- Double-click (desktop) / double-tap (mobile) to skip ---
  // A single click/tap on either half toggles play/pause, matching the
  // rest of the video area. A second click/tap on the SAME half within
  // DOUBLE_TAP_MS skips ±10s instead — this works identically for mouse
  // clicks and touch taps since both fire ordinary "click" events.
  function handleTapZone(zone: "left" | "right") {
    // The release of a press-and-hold also arrives as a click — it must
    // not toggle play/pause or count towards a double-tap.
    if (hold.consumeSuppressedClick()) {
      lastTapRef.current = null;
      return;
    }
    const now = Date.now();
    const last = lastTapRef.current;
    if (last && last.zone === zone && now - last.time < DOUBLE_TAP_MS) {
      seekBy(zone === "left" ? -seekSeconds : seekSeconds);
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
      {/* touch-pan-y: a vertical swipe on the video still scrolls the page (a hold
          that stays put, or slides sideways, is the hold-to-speed gesture).
          select-none / no callout: a long press mustn't select text or open
          the browser's press-and-hold menu. */}
      <div
        className="absolute inset-0 flex touch-pan-y select-none [-webkit-touch-callout:none]"
        onContextMenu={(e) => e.preventDefault()}
        {...hold.surfaceHandlers}
      >
        <button
          aria-label="Play/pause, or double-click to rewind 10 seconds"
          className="flex-1 outline-none focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-accent/70"
          style={{ WebkitTapHighlightColor: "transparent" }}
          onClick={() => handleTapZone("left")}
        />
        <button
          aria-label="Play/pause, or double-click to forward 10 seconds"
          className="flex-1 outline-none focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-accent/70"
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
          <span className="text-xs">{seekSeconds}s</span>
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

      {hold.holdRate !== null && <HoldSpeedIndicator rate={hold.holdRate} />}

      <SubtitleOverlay cues={cues} currentTime={currentTime} settings={subtitleSettings} />

      {videoStuck && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 px-6 text-center">
          <p className="text-sm text-white/80">This is taking longer than expected to load.</p>
          <button
            onClick={retryLoad}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:bg-accent/90"
          >
            Retry
          </button>
        </div>
      )}

      {buffering && !videoStuck && !error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-12 w-12 animate-spin rounded-full border-2 border-white/20 border-t-accent" />
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 px-6 text-center">
          <p className="text-white/90">{error}</p>
          <a href={backHref} className="text-sm text-secondary underline">
            Back to details
          </a>
        </div>
      )}

      {skipTarget && !showUpNext && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            seekTo(skipTarget.end);
          }}
          aria-label={SKIP_LABELS[skipTarget.kind]}
          className="absolute bottom-24 right-4 z-20 flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-bold text-black shadow-[0_6px_24px_rgba(0,0,0,0.6)] ring-2 ring-accent transition-transform hover:scale-105 active:scale-95 sm:right-6"
        >
          {SKIP_LABELS[skipTarget.kind]}
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
            <path d="M5 5v14l10-7zM17 5h2v14h-2z" />
          </svg>
        </button>
      )}

      {showUpNext && nextEpisode && (
        <div className="absolute bottom-24 right-6 z-20 flex items-center gap-3 rounded-xl border border-white/10 bg-canvas/95 p-3 shadow-2xl">
          <div className="text-sm">
            <p className="text-white/50">{autoNextWanted ? `Up next · playing in ${autoNextRemaining}s` : "Up next"}</p>
            <p className="text-white/90">{nextEpisode.label}</p>
          </div>
          <a
            href={nextEpisode.href}
            onClick={(e) => {
              if (autoNextWanted) flagAutoplayNext();
              handleEpisodeNavClick(e, nextEpisode.href);
            }}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover"
          >
            {autoNextWanted ? "Play now" : "Play"}
          </a>
          <button
            aria-label={autoNextWanted ? "Cancel autoplay" : "Dismiss"}
            onClick={() => setUpNextDismissed(true)}
            className={autoNextWanted ? "text-sm text-white/60 hover:text-white" : "text-white/40 hover:text-white/70"}
          >
            {autoNextWanted ? "Cancel" : "✕"}
          </button>
        </div>
      )}

      {ended && !nextEpisode && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70">
          <button
            onClick={replay}
            className="rounded-xl bg-accent px-6 py-3 font-medium text-on-accent hover:bg-accent/90"
          >
            Watch Again
          </button>
        </div>
      )}

      {sleepTimerFired && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70">
          <div className="mx-4 flex max-w-xs flex-col items-center gap-4 rounded-2xl border border-white/10 bg-canvas/95 p-6 text-center shadow-2xl">
            <p className="text-base font-medium text-white">Sleep timer ended playback</p>
            <div className="flex w-full gap-2">
              <button
                onClick={() => addSleepTime(15)}
                className="flex-1 rounded-lg bg-white/10 px-4 py-2.5 text-sm font-medium text-white/90 transition-colors hover:bg-white/20"
              >
                +15 min
              </button>
              <button
                onClick={dismissSleepTimerDialog}
                className="flex-1 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Control bar */}
      <div
        className={`absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/90 to-transparent px-4 pb-2 pt-7 transition-opacity duration-200 ${
          showControls ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <div
          className="group/scrub relative mb-1.5 flex h-4 w-full cursor-pointer items-center pointer-coarse:h-8"
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
              className="absolute left-0 top-0 h-full rounded-full bg-accent"
              style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
            >
              <div
                className={`absolute top-1/2 rounded-full bg-accent shadow-[0_0_2px_rgba(0,0,0,0.6)] transition-all duration-150 ease-out ${
                  scrubHover || scrubDragging ? "h-4 w-4" : "h-[13px] w-[13px]"
                }`}
                style={{ right: scrubHover || scrubDragging ? "-8px" : "-6.5px", transform: "translateY(-50%)" }}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-white">
          <PlayerTooltip label={playing ? "Pause" : "Play"} shortcuts={["Space", "K"]} align="start">
            <button
              aria-label="Play/Pause"
              onClick={togglePlay}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 transition-colors hover:bg-white/25"
            >
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>
          </PlayerTooltip>

          {(controls.seek_back || controls.seek_forward) && (
            <div className="flex items-center gap-0.5 rounded-full bg-white/15 p-1">
              {controls.seek_back && (
                <PlayerTooltip label={`Back ${seekSeconds} seconds`} shortcuts={["J"]}>
                  <button
                    aria-label={`Back ${seekSeconds} seconds`}
                    onClick={() => {
                      seekBy(-seekSeconds);
                      setSkipPulse({ side: "left", nonce: Date.now() });
                    }}
                    className="flex h-8 w-8 pointer-coarse:h-10 pointer-coarse:w-10 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/20 hover:text-white"
                  >
                    <BackIcon />
                  </button>
                </PlayerTooltip>
              )}
              {controls.seek_forward && (
                <PlayerTooltip label={`Forward ${seekSeconds} seconds`} shortcuts={["L"]}>
                  <button
                    aria-label={`Forward ${seekSeconds} seconds`}
                    onClick={() => {
                      seekBy(seekSeconds);
                      setSkipPulse({ side: "right", nonce: Date.now() });
                    }}
                    className="flex h-8 w-8 pointer-coarse:h-10 pointer-coarse:w-10 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/20 hover:text-white"
                  >
                    <ForwardIcon />
                  </button>
                </PlayerTooltip>
              )}
            </div>
          )}

          {controls.episodes && (prevEpisode || nextEpisode) && (
            <div className="flex items-center gap-0.5 rounded-full bg-white/15 p-1">
              {prevEpisode && (
                <PlayerTooltip label="Previous episode" shortcuts={["Shift+P"]}>
                  <a
                    href={prevEpisode.href}
                    onClick={(e) => handleEpisodeNavClick(e, prevEpisode.href)}
                    aria-label="Previous episode"
                    className="flex h-8 w-8 pointer-coarse:h-10 pointer-coarse:w-10 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/20 hover:text-white"
                  >
                    <PrevIcon />
                  </a>
                </PlayerTooltip>
              )}
              {nextEpisode && (
                <PlayerTooltip label="Next episode" shortcuts={["Shift+N"]}>
                  <a
                    href={nextEpisode.href}
                    onClick={(e) => handleEpisodeNavClick(e, nextEpisode.href)}
                    aria-label="Next episode"
                    className="flex h-8 w-8 pointer-coarse:h-10 pointer-coarse:w-10 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/20 hover:text-white"
                  >
                    <NextIcon />
                  </a>
                </PlayerTooltip>
              )}
            </div>
          )}

          {controls.volume && (
          <div className="player-volume-group flex h-10 items-center rounded-full bg-white/15 pl-1 pr-2">
            <PlayerTooltip label={muted || volume === 0 ? "Unmute" : "Mute"} shortcuts={["M"]}>
              <button
                aria-label="Mute/unmute"
                onClick={toggleMute}
                className="flex h-8 w-8 pointer-coarse:h-10 pointer-coarse:w-10 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/20"
              >
                {muted || volume === 0 ? (
                  <MuteIcon />
                ) : volume < 0.5 ? (
                  <VolumeLowIcon />
                ) : (
                  <VolumeHighIcon />
                )}
              </button>
            </PlayerTooltip>
            <div className="player-volume-wrap flex items-center overflow-hidden">
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(e) => changeVolume(Number(e.target.value))}
                className="w-20 accent-accent"
                aria-label="Volume"
              />
            </div>
          </div>
          )}

          {controls.time && (
            <div className="flex h-10 items-center whitespace-nowrap rounded-full bg-white/15 px-3.5 text-sm font-medium tabular-nums text-white">
              {formatTime(currentTime)} / {formatTime(duration)}
            </div>
          )}

          <div className="ml-auto flex items-center gap-1 rounded-full bg-white/15 px-1.5 py-1" ref={settingsRef}>
            {controls.captions && (
            <PlayerTooltip
              label={selectedLanguage ? "Turn off subtitles" : "Turn on subtitles"}
              shortcuts={["C"]}
              align="end"
            >
              <button
                aria-label={selectedLanguage ? "Turn off subtitles" : "Turn on subtitles"}
                aria-pressed={!!selectedLanguage}
                onClick={handleCaptionsButtonClick}
                className="flex h-8 w-8 pointer-coarse:h-10 pointer-coarse:w-10 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/20 hover:text-white"
              >
                <CCIcon active={!!selectedLanguage} />
              </button>
            </PlayerTooltip>
            )}

            <div className="relative">
              {/* No tooltip while the menu is open — it would sit on top of it. */}
              <PlayerTooltip label="Settings" shortcuts={["S"]} align="end" disabled={settingsMenu !== null}>
                <button
                  aria-label="Settings"
                  onClick={() => setSettingsMenu((v) => (v ? null : "root"))}
                  className="flex h-8 w-8 pointer-coarse:h-10 pointer-coarse:w-10 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/20 hover:text-white"
                >
                  <GearIcon />
                </button>
              </PlayerTooltip>

              {settingsMenu !== null &&
                settingsAnchor !== null &&
                createPortal(
                  <div
                    ref={settingsPortalRef}
                    style={{
                      position: "fixed",
                      right: settingsAnchor.right,
                      ...(settingsMenuDirection === "up"
                        ? { bottom: window.innerHeight - settingsAnchor.top + 8 }
                        : { top: settingsAnchor.bottom + 8 }),
                    }}
                    className="z-50"
                  >
                    {settingsMenu === "root" && (
                      <div
                        style={{ maxHeight: settingsMenuMaxHeight }}
                        className="w-56 overflow-y-auto overflow-x-hidden rounded-xl border border-white/10 bg-canvas/95 py-1 shadow-2xl backdrop-blur"
                      >
                        <button
                          onClick={() => setSettingsMenu("speed")}
                          className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm text-white/90 hover:bg-white/10"
                        >
                          <span>Playback speed</span>
                          <span className="text-white/50">
                            {playbackRate === 1 ? "Normal" : `${playbackRate}x`}
                          </span>
                        </button>
                        <button
                          onClick={() => setSettingsMenu("subtitles")}
                          className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm text-white/90 hover:bg-white/10"
                        >
                          <span>Subtitles</span>
                          <span className="flex items-center gap-2 text-white/50">
                            {selectedLanguage && <Flag language={selectedLanguage} size="sm" />}
                            {selectedLanguage
                              ? (allTracks.find((t) => t.language === selectedLanguage)?.label ??
                                selectedLanguage)
                              : "Off"}
                          </span>
                        </button>
                        <button
                          onClick={() => setSettingsMenu("sleepTimer")}
                          className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm text-white/90 hover:bg-white/10"
                        >
                          <span>Sleep timer</span>
                          <span className="text-white/50">
                            {sleepTimerMinutes ? (sleepTimerRemainingLabel ?? "…") : "Off"}
                          </span>
                        </button>
                      </div>
                    )}

                    {settingsMenu === "speed" && (
                      <div
                        style={{ maxHeight: settingsMenuMaxHeight }}
                        className="w-48 overflow-y-auto overflow-x-hidden rounded-xl border border-white/10 bg-canvas/95 py-1 shadow-2xl backdrop-blur"
                      >
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
                              s === playbackRate ? "text-accent" : "text-white/90"
                            }`}
                          >
                            {s === 1 ? "Normal" : `${s}x`}
                          </button>
                        ))}
                      </div>
                    )}

                    {settingsMenu === "sleepTimer" && (
                      <div
                        style={{ maxHeight: settingsMenuMaxHeight }}
                        className="w-48 overflow-y-auto overflow-x-hidden rounded-xl border border-white/10 bg-canvas/95 py-1 shadow-2xl backdrop-blur"
                      >
                        <button
                          onClick={() => setSettingsMenu("root")}
                          className="flex w-full items-center gap-2 border-b border-white/10 px-3 py-2.5 text-left text-sm text-white/90 hover:bg-white/10"
                        >
                          <BackChevronIcon />
                          Sleep timer
                        </button>
                        <button
                          onClick={() => {
                            startSleepTimer(null);
                            setSettingsMenu("root");
                          }}
                          className={`block w-full px-3 py-2 text-left text-sm hover:bg-white/10 ${
                            sleepTimerMinutes === null ? "text-accent" : "text-white/90"
                          }`}
                        >
                          Off
                        </button>
                        {SLEEP_TIMER_OPTIONS.map((m) => (
                          <button
                            key={m}
                            onClick={() => {
                              startSleepTimer(m);
                              setSettingsMenu("root");
                            }}
                            className={`block w-full px-3 py-2 text-left text-sm hover:bg-white/10 ${
                              m === sleepTimerMinutes ? "text-accent" : "text-white/90"
                            }`}
                          >
                            {m} minutes
                          </button>
                        ))}
                      </div>
                    )}

                    {settingsMenu === "subtitles" && (
                      <div
                        style={{ maxHeight: settingsMenuMaxHeight }}
                        className="flex flex-col items-end gap-1 overflow-y-auto overflow-x-hidden"
                      >
                        <button
                          onClick={() => setSettingsMenu("root")}
                          className="flex w-56 shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-canvas/95 px-3 py-2.5 text-left text-sm text-white/90 shadow-2xl backdrop-blur hover:bg-white/10"
                        >
                          <BackChevronIcon />
                          Subtitles
                        </button>
                        <SubtitleSettingsPanel
                          tracks={allTracks}
                          listedTracks={listedTracks}
                          selectedLanguage={selectedLanguage}
                          onSelectLanguage={selectSubtitleLanguage}
                          settings={subtitleSettings}
                          onChange={updateSubtitleSettings}
                          identity={identity}
                          onTrackAdded={(track) => {
                            setOnlineTracks((prev) => [...prev.filter((t) => t.url !== track.url), track]);
                            selectSubtitleLanguage(track.language);
                          }}
                        />
                      </div>
                    )}
                  </div>,
                  // Fullscreen's "top layer" only contains the fullscreened
                  // element's own subtree — document.body sits outside
                  // that once containerRef goes fullscreen, so mount
                  // there instead when that's the case.
                  fullscreen && containerRef.current ? containerRef.current : document.body
                )}
            </div>

            {controls.pip && pipSupported && (
              <PlayerTooltip label="Picture in picture" shortcuts={["P"]} align="end">
                <button
                  aria-label="Picture in picture"
                  onClick={() => void togglePip()}
                  className="flex h-8 w-8 pointer-coarse:h-10 pointer-coarse:w-10 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/20 hover:text-white"
                >
                  <PipIcon />
                </button>
              </PlayerTooltip>
            )}

            {controls.fullscreen && (
            <PlayerTooltip label={fullscreen ? "Exit fullscreen" : "Fullscreen"} shortcuts={["F"]} align="end">
              <button
                aria-label="Fullscreen"
                onClick={toggleFullscreen}
                className="flex h-8 w-8 pointer-coarse:h-10 pointer-coarse:w-10 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/20 hover:text-white"
              >
                {fullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
              </button>
            </PlayerTooltip>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
