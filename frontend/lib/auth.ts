/**
 * Auth API client.
 *
 * All requests use `credentials: "include"` so the HttpOnly session
 * cookie is sent/received across the frontend<->backend origins.
 * Session state is never stored in localStorage — the cookie is the
 * only place it lives, and JS never reads or writes it directly.
 */
import { getApiBaseUrl } from "@/lib/api-client";

export type UserPublic = {
  id: string;
  username: string;
  display_name: string;
  created_at: string;
};

export async function listUsers(): Promise<UserPublic[]> {
  const res = await fetch(`${getApiBaseUrl()}/auth/users`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed to load users");
  return res.json();
}

export async function login(username: string, password: string): Promise<UserPublic> {
  const res = await fetch(`${getApiBaseUrl()}/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? "Login failed");
  }
  return res.json();
}

export async function logout(): Promise<void> {
  await fetch(`${getApiBaseUrl()}/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
}

export async function getCurrentUser(): Promise<UserPublic | null> {
  const res = await fetch(`${getApiBaseUrl()}/auth/me`, {
    credentials: "include",
    cache: "no-store",
  });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error("Failed to load current user");
  return res.json();
}
