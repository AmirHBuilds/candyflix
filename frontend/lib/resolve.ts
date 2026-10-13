import { getApiBaseUrl, getStaticOrigin } from "@/lib/api-client";

/** Candy Resolver, as the backend (/api/resolve) shows it: sources, their qualities and download progress. */

export type StreamState = {
  stream_id: string;
  quality: string;
  rank: number;
  // idle = not downloaded · downloading = being fetched (it may already play) · ready · failed
  state: "idle" | "downloading" | "ready" | "failed";
  progress: number | null; // 0-100
  duration_seconds: number | null; // the real length of the whole video
  library_id: string | null;
  play_url: string | null;
  error: string | null;
};

export type SourceState = {
  name: string;
  starred: boolean;
  status: string;
  error: string | null;
  streams: StreamState[];
};

export type ResolverSubtitle = {
  language: string;
  label: string;
  url: string;
  format: "srt" | "vtt";
  source: string | null;
  default: boolean;
};

export type ResolveState = {
  task_id: string;
  status: "running" | "done" | "expired";
  version: number;
  sources_total: number;
  sources_done: number;
  queue_position: number | null;
  has_more: boolean; // sources that haven't been asked yet exist
  sources: SourceState[];
  subtitles: ResolverSubtitle[];
  auto_stream_id: string | null;
};

export type ResolveTarget = {
  mediaType: "movie" | "tv";
  tmdbId: number;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
};

/**
 * A video / subtitle address from the backend. A path ("/api/resolve/relay?u=…", the relay used while
 * everything runs on one machine) lives on the backend's origin; a full link (the resolver's own, once it
 * allows CORS and RESOLVER_STREAM_MODE=direct) is used as it is.
 */
export function mediaUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `${getStaticOrigin()}${url}`;
}

/** True when a media address belongs to someone else (so our sign-in cookie must not be sent). */
export function isExternalUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) && !url.startsWith(getStaticOrigin());
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    credentials: "include",
    cache: "no-store",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = "The video service isn't reachable right now.";
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      // keep the default
    }
    throw new Error(detail);
  }
  return res.json();
}

export function startResolve(t: ResolveTarget, signal?: AbortSignal): Promise<ResolveState> {
  return call("/resolve/start", {
    method: "POST",
    signal,
    body: JSON.stringify({
      media_type: t.mediaType,
      tmdb_id: t.tmdbId,
      season_number: t.seasonNumber ?? null,
      episode_number: t.episodeNumber ?? null,
    }),
  });
}

export function getResolveState(taskId: string, opts: { after?: number; waitS?: number; signal?: AbortSignal } = {}): Promise<ResolveState> {
  const q = opts.after !== undefined && opts.waitS ? `?after=${opts.after}&wait_s=${opts.waitS}` : "";
  return call(`/resolve/tasks/${encodeURIComponent(taskId)}${q}`, { signal: opts.signal });
}

export function requestDownload(taskId: string, streamId: string | null): Promise<ResolveState> {
  return call(`/resolve/tasks/${encodeURIComponent(taskId)}/download`, {
    method: "POST",
    body: JSON.stringify({ stream_id: streamId }),
  });
}

/** Asks for more sources: about half of them (`all` false), or every one that is left (`all` true). */
export function loadMoreSources(taskId: string, all: boolean): Promise<ResolveState> {
  return call(`/resolve/tasks/${encodeURIComponent(taskId)}/more`, { method: "POST", body: JSON.stringify({ all }) });
}

export function findStream(state: ResolveState | null, streamId: string | null): StreamState | null {
  if (!state || !streamId) return null;
  for (const src of state.sources) for (const s of src.streams) if (s.stream_id === streamId) return s;
  return null;
}

export function sourceOf(state: ResolveState | null, streamId: string | null): SourceState | null {
  if (!state || !streamId) return null;
  return state.sources.find((src) => src.streams.some((s) => s.stream_id === streamId)) ?? null;
}

export function anyDownloading(state: ResolveState | null): boolean {
  return !!state && state.sources.some((src) => src.streams.some((s) => s.state === "downloading"));
}

export function hasStreams(state: ResolveState | null): boolean {
  return !!state && state.sources.some((src) => src.streams.length > 0);
}
