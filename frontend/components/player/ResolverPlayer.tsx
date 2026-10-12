"use client";

import { useEffect, useMemo, useState } from "react";
import VideoPlayer from "@/components/player/VideoPlayer";
import PlayerLoading from "@/components/player/PlayerLoading";
import { useResolver } from "@/components/player/useResolver";
import type { WatchIdentity } from "@/components/player/useWatchProgress";
import type { PlaybackSource, SubtitleTrack } from "@/lib/playback";
import { findStream, sourceOf } from "@/lib/resolve";
import { showToast } from "@/lib/toast";

/**
 * The real player: waits (with a loading screen) while the server finds and starts a video, then plays it
 * and offers the sources and qualities in the player's source menu.
 */
export default function ResolverPlayer({
  source,
  title,
  identity,
  backHref,
  nextEpisode,
  prevEpisode,
  artwork,
  runtimeSeconds,
}: {
  source: PlaybackSource;
  title: string;
  identity: WatchIdentity;
  backHref: string;
  nextEpisode?: { href: string; label: string } | null;
  prevEpisode?: { href: string; label: string } | null;
  artwork: string | null;
  /** The listed length of the film / episode, to show a sensible end time while it still downloads. */
  runtimeSeconds?: number | null;
}) {
  const r = useResolver({
    mediaType: identity.mediaType,
    tmdbId: identity.tmdbId,
    seasonNumber: identity.seasonNumber,
    episodeNumber: identity.episodeNumber,
  });

  // The link of the playing stream is frozen when it starts: the server hands out a fresh signed link on
  // every poll, and swapping it under a playing video would restart it.
  const [locked, setLocked] = useState<{ id: string; url: string } | null>(null);
  useEffect(() => {
    if (r.playingId && r.playing?.play_url && locked?.id !== r.playingId) {
      setLocked({ id: r.playingId, url: r.playing.play_url });
    }
  }, [r.playingId, r.playing?.play_url, locked?.id]);

  // Set when the person switches source, so the new one carries on from the same spot.
  const [switchedAt, setSwitchedAt] = useState<number | null>(null);

  const tracks = useMemo<SubtitleTrack[]>(
    () =>
      (r.state?.subtitles ?? []).map((s) => ({
        language: s.language,
        label: s.source ? `${s.label} · ${s.source}` : s.label,
        url: s.url,
        format: s.format,
        origin: "source",
      })),
    [r.state?.subtitles]
  );

  const playerSource = useMemo<PlaybackSource | null>(
    () =>
      locked
        ? {
            ...source,
            url: locked.url,
            subtitles: [...source.subtitles, ...tracks],
            resume_position_seconds: switchedAt ?? source.resume_position_seconds,
          }
        : null,
    [locked, source, tracks, switchedAt]
  );

  if (r.phase !== "playing" || !playerSource || !locked || locked.id !== r.playingId) {
    const target = findStream(r.state, r.state?.auto_stream_id ?? null);
    return (
      <PlayerLoading
        phase={r.phase === "playing" ? "starting" : r.phase}
        artwork={artwork}
        title={title}
        sourceName={sourceOf(r.state, r.state?.auto_stream_id ?? null)?.name ?? null}
        stream={target}
        error={r.error}
        queuePosition={r.state?.queue_position ?? null}
        onRetry={r.retry}
        backHref={backHref}
      />
    );
  }

  return (
    <VideoPlayer
      key={locked.id}
      source={playerSource}
      title={title}
      identity={identity}
      backHref={backHref}
      nextEpisode={nextEpisode}
      prevEpisode={prevEpisode}
      poster={artwork}
      growth={{ ready: r.playing?.state === "ready", progress: r.playing?.progress ?? null, runtimeSeconds: runtimeSeconds ?? null }}
      forceResume={switchedAt !== null}
      autoStart={switchedAt !== null}
      sourcePicker={{
        sources: r.state?.sources ?? [],
        playingId: r.playingId,
        searching: !!r.searching,
        onSelect: (streamId, atSeconds, totalSeconds) => {
          const s = findStream(r.state, streamId);
          // Another quality that hasn't downloaded as far as you have watched: say so instead of jumping back.
          if (
            s?.play_url &&
            streamId !== r.playingId &&
            s.state !== "ready" &&
            s.progress != null &&
            totalSeconds > 0 &&
            atSeconds > 30 &&
            (s.progress / 100) * totalSeconds < atSeconds + 15
          ) {
            showToast(`That one has only downloaded ${Math.round(s.progress)}% so far, not up to where you are yet.`, "info");
            return;
          }
          if (s?.play_url && streamId !== r.playingId) setSwitchedAt(atSeconds);
          if (!s?.play_url && s?.state === "downloading") showToast("Still getting it ready. Click it again in a moment.", "info");
          r.choose(streamId);
        },
      }}
    />
  );
}
