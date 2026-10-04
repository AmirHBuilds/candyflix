/** Client for /api/admin (admins only). */
import { fetchWithTimeout, getApiBaseUrl } from "@/lib/api-client";

export type AdminUser = {
  id: string;
  username: string;
  display_name: string;
  is_admin: boolean;
  is_disabled: boolean;
  created_at: string;
  last_login_at: string | null;
  avatar_url: string | null;
  watchlist_count: number;
  watched_count: number;
};

export type AdminStats = {
  users_total: number;
  admins: number;
  disabled: number;
  active_last_7_days: number;
  watchlist_items: number;
  watched_items: number;
  activity: { date: string; saves: number; active_users: number }[];
  top_titles: { tmdb_id: number; media_type: string; title: string | null; viewers: number }[];
  recent_logins: { id: string; username: string; display_name: string; avatar_url: string | null; last_login_at: string }[];
};

export type ServiceCheck = { ok: boolean; detail: string; latency_ms: number | null };
export type SystemStatus = {
  database: ServiceCheck;
  redis: ServiceCheck;
  tmdb: ServiceCheck;
  opensubtitles: ServiceCheck;
  subtitle_cache: { files: number; bytes: number };
  avatars: { files: number; bytes: number };
  app_version: string;
  python_version: string;
  auto_migrate: boolean;
  debug: boolean;
};

async function request<T>(path: string, init: RequestInit = {}, fallback = "Something went wrong."): Promise<T> {
  const res = await fetchWithTimeout(`${getApiBaseUrl()}/admin${path}`, {
    credentials: "include",
    cache: "no-store",
    ...init,
    headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = body?.detail;
    const message =
      typeof detail === "string" ? detail : Array.isArray(detail) ? detail[0]?.msg?.replace(/^Value error, /, "") : null;
    throw new Error(message || fallback);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const listAdminUsers = () => request<AdminUser[]>("/users", {}, "Couldn't load users.");
export const createAdminUser = (body: { username: string; display_name: string; password: string; is_admin: boolean }) =>
  request<AdminUser>("/users", { method: "POST", body: JSON.stringify(body) }, "Couldn't create that user.");
export const updateAdminUser = (
  id: string,
  body: Partial<{ username: string; display_name: string; is_admin: boolean; is_disabled: boolean }>
) => request<AdminUser>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }, "Couldn't save the changes.");
export const resetAdminPassword = (id: string, newPassword: string) =>
  request<void>(`/users/${id}/password`, { method: "POST", body: JSON.stringify({ new_password: newPassword }) }, "Couldn't reset the password.");
export const deleteAdminUser = (id: string) => request<void>(`/users/${id}`, { method: "DELETE" }, "Couldn't delete that user.");
export const getAdminStats = () => request<AdminStats>("/stats", {}, "Couldn't load the dashboard.");
export const getSystemStatus = () => request<SystemStatus>("/system", {}, "Couldn't check the system.");
export const clearTmdbCache = () =>
  request<{ cleared: number }>("/system/clear-tmdb-cache", { method: "POST" }, "Couldn't clear the TMDB cache.");
export const clearSubtitleCache = () =>
  request<{ cleared: number }>("/system/clear-subtitle-cache", { method: "POST" }, "Couldn't clear the subtitle cache.");

export const getAdminFooter = () => request<import("@/lib/site").FooterContent>("/footer", {}, "Couldn't load the footer.");
export const saveAdminFooter = (body: import("@/lib/site").FooterContent) =>
  request<import("@/lib/site").FooterContent>("/footer", { method: "PUT", body: JSON.stringify(body) }, "Couldn't save the footer.");
