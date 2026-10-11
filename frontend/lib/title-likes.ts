"use client";

/**
 * Likes for one title or episode, shared by every component on the page that shows them (the heart button and the
 * "Candy liked this" line stay in step). Loaded once per mount; `enabled` is false when opinions are switched off.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { getTitleOpinions, likeTitle, type LikeSummary, type Scope } from "@/lib/opinions";
import { showToast } from "@/lib/toast";

type State = { enabled: boolean | null; likes: LikeSummary; comments: number };
const EMPTY: State = { enabled: null, likes: { count: 0, you_liked: false, people: [], more: 0 }, comments: 0 };

const states = new Map<string, State>();
const inflight = new Map<string, Promise<Awaited<ReturnType<typeof getTitleOpinions>>>>();
const listeners = new Map<string, Set<() => void>>();

export const scopeKey = (s: Scope) => `${s.media_type}:${s.tmdb_id}:${s.season_number ?? -1}:${s.episode_number ?? -1}`;
const get = (key: string) => states.get(key) ?? EMPTY;
function set(key: string, next: State) {
  states.set(key, next);
  listeners.get(key)?.forEach((l) => l());
}

/** The discussion panel tells everyone else on the page how many comments there are now. */
export function setCommentCount(scope: Scope, comments: number) {
  const key = scopeKey(scope);
  const cur = get(key);
  if (cur.comments !== comments) set(key, { ...cur, comments });
}

export function useTitleLikes(scope: Scope, active = true) {
  const key = scopeKey(scope);
  const { media_type, tmdb_id, season_number, episode_number } = scope;

  const state = useSyncExternalStore(
    (cb) => {
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key)!.add(cb);
      return () => listeners.get(key)?.delete(cb);
    },
    () => get(key),
    () => EMPTY
  );

  useEffect(() => {
    if (!active) return;
    let live = true;
    // The heart, the "liked by" line and the discussion button all ask at once: share one request.
    let request = inflight.get(key);
    if (!request) {
      request = getTitleOpinions({ media_type, tmdb_id, season_number, episode_number });
      inflight.set(key, request);
      const forget = () => setTimeout(() => inflight.delete(key), 1500);
      request.then(forget, forget);
    }
    request
      .then((d) => live && set(key, { enabled: d.enabled, likes: d.likes, comments: d.comment_count }))
      .catch(() => live && set(key, { enabled: false, likes: EMPTY.likes, comments: 0 }));
    return () => {
      live = false;
    };
  }, [active, key, media_type, tmdb_id, season_number, episode_number]);

  const toggle = useCallback(async () => {
    const cur = get(key);
    const next = !cur.likes.you_liked;
    // Show it at once; the server's answer replaces it.
    set(key, { ...cur, likes: { ...cur.likes, you_liked: next, count: Math.max(0, cur.likes.count + (next ? 1 : -1)) } });
    try {
      set(key, { ...get(key), enabled: true, likes: await likeTitle({ media_type, tmdb_id, season_number, episode_number }, next) });
    } catch (e) {
      set(key, cur);
      showToast(e instanceof Error ? e.message : "Couldn't save that.");
    }
  }, [key, media_type, tmdb_id, season_number, episode_number]);

  return { enabled: state.enabled === true, loaded: state.enabled !== null, likes: state.likes, comments: state.comments, toggle };
}
