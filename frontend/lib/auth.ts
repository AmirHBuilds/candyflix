/**
 * Auth API client.
 *
 * All requests use `credentials: "include"` so the HttpOnly session
 * cookie is sent/received across the frontend<->backend origins.
 * Session state is never stored in localStorage — the cookie is the
 * only place it lives, and JS never reads or writes it directly.
 */
import { getApiBaseUrl, fetchWithTimeout } from "@/lib/api-client";

export type UserPublic = {
  is_admin?: boolean; // the profile picker uses it to draw the crown
  id: string;
  username: string;
  display_name: string;
  avatar_url?: string | null; // a path like /avatars/<file>.webp, served by the backend
  created_at: string;
};

// Account changes (name, picture) happen on a page far from the header, so
// they announce themselves and the header re-reads the person.
const USER_CHANGED = "candyflix:user-changed";

export function notifyUserChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(USER_CHANGED));
}

export function onUserChanged(listener: () => void): () => void {
  window.addEventListener(USER_CHANGED, listener);
  return () => window.removeEventListener(USER_CHANGED, listener);
}

export async function listUsers(): Promise<UserPublic[]> {
  const res = await fetchWithTimeout(`${getApiBaseUrl()}/auth/users`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed to load users");
  return res.json();
}

/** What /auth/login says: the person, or (two-step sign-in on) a challenge to answer with the code. */
export type LoginResult = { kind: "signed_in"; user: UserPublic } | { kind: "code"; challenge: string };

async function loginFail(res: Response, fallback: string): Promise<never> {
  const body = await res.json().catch(() => ({}));
  throw new Error(typeof body.detail === "string" ? body.detail : fallback);
}

export async function login(username: string, password: string): Promise<LoginResult> {
  const res = await fetchWithTimeout(`${getApiBaseUrl()}/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) await loginFail(res, "Login failed");
  const body = await res.json();
  return body.two_factor_required ? { kind: "code", challenge: body.challenge } : { kind: "signed_in", user: body };
}

export async function verifyLoginCode(challenge: string, code: string): Promise<UserPublic> {
  const res = await fetchWithTimeout(`${getApiBaseUrl()}/auth/login/verify`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ challenge, code }),
  });
  if (!res.ok) await loginFail(res, "That code isn't right.");
  return res.json();
}

export async function resendLoginCode(challenge: string): Promise<void> {
  const res = await fetchWithTimeout(`${getApiBaseUrl()}/auth/login/resend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ challenge }),
  });
  if (!res.ok) await loginFail(res, "Couldn't send another code.");
}

export async function logout(): Promise<void> {
  await fetchWithTimeout(`${getApiBaseUrl()}/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
}

export async function getCurrentUser(): Promise<UserPublic | null> {
  const res = await fetchWithTimeout(`${getApiBaseUrl()}/auth/me`, {
    credentials: "include",
    cache: "no-store",
  });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error("Failed to load current user");
  return res.json();
}
