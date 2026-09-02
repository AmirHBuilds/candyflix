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
