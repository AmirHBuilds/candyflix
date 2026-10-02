/**
 * Minimal API client for talking to the CandyFlix backend.
 *
 * Kept intentionally small for Phase 1 — just enough to prove
 * frontend -> backend connectivity. Feature-specific calls (TMDB,
 * watchlist, playback, auth) are added in later phases.
 *
 * IMPORTANT — two different URLs are needed:
 *
 * - Code running in the BROWSER needs a URL reachable from the
 *   user's machine: http://localhost:8000/api (via the port mapping
 *   in docker-compose.yml). This is `NEXT_PUBLIC_API_URL`.
 *
 * - Code running on the SERVER (e.g. this file, when called from an
 *   async Server Component like app/page.tsx) executes inside the
 *   `frontend` container's own Node process. Inside that container,
 *   "localhost" refers to the frontend container itself — there is
 *   nothing listening on port 8000 there, so a request to
 *   http://localhost:8000/api from server-side code fails, even
 *   though the backend is perfectly healthy and reachable from the
 *   browser or via `docker compose logs`. Server-side code must
 *   instead use the Docker Compose service DNS name: `backend`
 *   (i.e. http://backend:8000/api). This is `API_URL_INTERNAL`.
 *
 * Outside Docker (plain `npm run dev` against a locally-running
 * backend), both the browser and the server process share the same
 * network namespace, so `NEXT_PUBLIC_API_URL=http://localhost:8000/api`
 * works correctly for both and `API_URL_INTERNAL` doesn't need to be set.
 */

const isServer = typeof window === "undefined";

export function getApiBaseUrl(): string {
  return isServer
    ? process.env.API_URL_INTERNAL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api"
    : process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";
}

/**
 * The mock video/subtitle folders are mounted at the backend's root
 * (e.g. /mock-videos/movie.mp4), not under /api — this strips the
 * /api suffix off the browser-facing base URL to get the plain
 * origin. Only ever needed client-side (a <video> element's src and
 * subtitle fetches both run in the browser), so this doesn't need the
 * server/browser branching that getApiBaseUrl() does.
 */
export function getStaticOrigin(): string {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";
  return base.replace(/\/api\/?$/, "");
}

/** How long a data request may take before we give up on it. */
export const FETCH_TIMEOUT_MS = 20_000;

export class RequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`The request took longer than ${Math.round(timeoutMs / 1000)}s and was cancelled.`);
    this.name = "RequestTimeoutError";
  }
}

/**
 * `fetch` that gives up after `timeoutMs` instead of waiting forever.
 *
 * Plain fetch has no timeout, so a stalled connection (a dropped
 * keep-alive socket between containers, a hung upstream) leaves a Server
 * Component awaiting indefinitely — the visitor then sits on the page's
 * loading skeleton for good. With this, a stall becomes an ordinary
 * error that the page/boundary already knows how to show ("Try again").
 *
 * Covers waiting for the response *headers* (where such stalls happen);
 * the timer stops once they arrive. A caller's own `signal` (e.g. the
 * debounced search cancelling a stale query) still works and is merged.
 * Passes `init` through untouched apart from adding the signal.
 */
export async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs: number = FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const callerSignal = init.signal ?? undefined;
  const onCallerAbort = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) controller.abort(callerSignal.reason);
  else callerSignal?.addEventListener("abort", onCallerAbort);

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (timedOut) throw new RequestTimeoutError(timeoutMs);
    throw err;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }
}

export async function getBackendHealth() {
  const res = await fetch(`${getApiBaseUrl()}/health/full`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Backend health check failed: ${res.status}`);
  }
  return res.json() as Promise<{
    status: string;
    database: string;
    redis: string;
  }>;
}
