"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { showToast } from "@/lib/toast";
import {
  anyDownloading,
  findStream,
  getResolveState,
  hasStreams,
  requestDownload,
  loadMoreSources,
  startResolve,
  type ResolveState,
  type ResolveTarget,
} from "@/lib/resolve";

const POLL_WHILE_DOWNLOADING_MS = 1500;
const POLL_ERROR_MS = 4000;

export type ResolverPhase = "finding" | "starting" | "playing" | "failed";

/**
 * Drives real playback: asks the backend to find a video (the first source to answer wins), keeps the
 * list of sources and download progress fresh, and says which stream is playing.
 *
 * - "finding": still searching for the first source
 * - "starting": a source was found and its best quality is downloading, not playable yet
 * - "playing": there is a link to play
 * - "failed": nothing could be found, or the video service is down
 */
export function useResolver(target: ResolveTarget) {
  const [state, setState] = useState<ResolveState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Bumps when something should be polled again right away (a download was just requested).
  const [kick, setKick] = useState(0);
  const stateRef = useRef<ResolveState | null>(null);
  stateRef.current = state;
  const autoAskedRef = useRef<string | null>(null);
  const autoCountRef = useRef(0);

  const key = `${target.mediaType}:${target.tmdbId}:${target.seasonNumber ?? ""}:${target.episodeNumber ?? ""}`;

  // Start (and start again on "Try again").
  useEffect(() => {
    const ctl = new AbortController();
    setState(null);
    setError(null);
    setPlayingId(null);
    autoAskedRef.current = null;
    autoCountRef.current = 0;
    startResolve(target, ctl.signal)
      .then((s) => !ctl.signal.aborted && setState(s))
      .catch((e) => !ctl.signal.aborted && setError(e instanceof Error ? e.message : "Couldn't start."));
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  // Keep the state fresh: quickly while something downloads, by long-polling while sources are still arriving.
  const taskId = state?.task_id;
  useEffect(() => {
    if (!taskId) return;
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick() {
      const cur = stateRef.current;
      if (!cur || ctl.signal.aborted) return;
      const downloading = anyDownloading(cur);
      const searching = cur.status === "running";
      if (!downloading && !searching) return; // nothing is changing any more
      try {
        const next = await getResolveState(cur.task_id, {
          after: !downloading ? cur.version : undefined,
          waitS: !downloading ? 20 : 0,
          signal: ctl.signal,
        });
        if (ctl.signal.aborted) return;
        setState(next);
        stateRef.current = next;
        timer = setTimeout(tick, anyDownloading(next) ? POLL_WHILE_DOWNLOADING_MS : 0);
      } catch {
        if (!ctl.signal.aborted) timer = setTimeout(tick, POLL_ERROR_MS);
      }
    }
    timer = setTimeout(tick, anyDownloading(stateRef.current) ? POLL_WHILE_DOWNLOADING_MS : 0);
    return () => {
      ctl.abort();
      if (timer) clearTimeout(timer);
    };
  }, [taskId, kick]);

  // A source turned up but nothing has been started yet (the first answer came after the wait): start the best one.
  useEffect(() => {
    if (!state || state.auto_stream_id || !hasStreams(state)) return;
    // Asked again whenever the picture changes (a quality failed or was removed by the resolver): the server picks the
    // next SOURCE, or searches again, and gives up by itself. At most 6 asks per search.
    const key = `${state.task_id}:${state.sources.reduce((n, src) => n + src.streams.length * 10 + src.streams.filter((x) => x.state === "failed").length, 0)}`;
    if (autoAskedRef.current === key || autoCountRef.current >= 6) return;
    autoAskedRef.current = key;
    autoCountRef.current += 1;
    requestDownload(state.task_id, null)
      .then((s) => {
        setState(s);
        stateRef.current = s;
        setKick((k) => k + 1);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't start the download."));
  }, [state]);

  // Play the automatic pick as soon as it can be played.
  useEffect(() => {
    if (playingId || !state?.auto_stream_id) return;
    const s = findStream(state, state.auto_stream_id);
    if (s?.play_url) setPlayingId(s.stream_id);
  }, [state, playingId]);

  const playing = findStream(state, playingId);

  /** A click on a quality in the menu: play it if it can play, otherwise start downloading it. */
  const choose = useCallback(
    (streamId: string): "switch" | "download" | "wait" => {
      const cur = stateRef.current;
      const s = findStream(cur, streamId);
      if (!cur || !s) return "wait";
      if (s.play_url) {
        setPlayingId(streamId);
        return "switch";
      }
      if (s.state === "downloading") return "wait"; // on its way, not playable yet
      // idle or failed: ask for it and show it as downloading at once
      setState((prev) =>
        prev
          ? {
              ...prev,
              sources: prev.sources.map((src) => ({
                ...src,
                streams: src.streams.map((x) => (x.stream_id === streamId ? { ...x, state: "downloading", progress: 0, error: null } : x)),
              })),
            }
          : prev
      );
      requestDownload(cur.task_id, streamId)
        .then((next) => {
          setState(next);
          stateRef.current = next;
          setKick((k) => k + 1);
        })
        .catch((e) => {
          const msg = e instanceof Error ? e.message : "Couldn't start the download.";
          if (stateRef.current && findStream(stateRef.current, stateRef.current.auto_stream_id)?.play_url) showToast(msg);
          else setError(msg);
          getResolveState(cur.task_id).then(setState).catch(() => {});
        });
      return "download";
    },
    []
  );

  // The video broke while playing (its file was removed, the link died): forget the playing stream and ask the server
  // to start again. It restarts the same source if that did not fail (a removed file is not a failed source), moves
  // to the next source if it did, and searches again when none is left. At most 3 times per page, so it never loops.
  const recoverRef = useRef(0);
  const recover = useCallback(() => {
    const cur = stateRef.current;
    if (!cur || recoverRef.current >= 3) return false;
    recoverRef.current += 1;
    setPlayingId(null);
    getResolveState(cur.task_id)
      .catch(() => cur)
      .then((fresh) => {
        setState(fresh);
        stateRef.current = fresh;
        return requestDownload(fresh.task_id, null);
      })
      .then((next) => {
        setState(next);
        stateRef.current = next;
        setKick((k) => k + 1);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't start the video again."));
    return true;
  }, []);
  useEffect(() => {
    recoverRef.current = 0;
  }, [key, attempt]);

  let phase: ResolverPhase = "finding";
  const noVideoAnywhere = !!state && state.status !== "running" && !hasStreams(state);
  if (playing?.play_url) phase = "playing";
  else if ((error && !playing) || noVideoAnywhere) phase = "failed";
  else if (hasStreams(state)) phase = "starting";

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  // "Load more sources": the first click asks for about half of them, the next one for every source left.
  const [moreStep, setMoreStep] = useState<0 | 1>(0);
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => setMoreStep(0), [taskId]);
  const more = useCallback(() => {
    const cur = stateRef.current;
    if (!cur || loadingMore) return;
    setLoadingMore(true);
    loadMoreSources(cur.task_id, moreStep === 1)
      .then((next) => {
        setState(next);
        stateRef.current = next;
        setMoreStep(1);
        setKick((k) => k + 1);
      })
      .catch((e) => showToast(e instanceof Error ? e.message : "Couldn't look for more sources."))
      .finally(() => setLoadingMore(false));
  }, [moreStep, loadingMore]);

  return {
    phase,
    state,
    error: phase === "failed" ? (error ?? "No video was found for this one yet.") : null,
    playingId,
    playing,
    choose,
    recover,
    retry,
    more,
    moreStep,
    loadingMore,
    hasMore: !!state?.has_more,
    searching: state?.status === "running",
  };
}
