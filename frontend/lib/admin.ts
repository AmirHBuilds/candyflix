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
  omdb: ServiceCheck;
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

// --- Phase 10a: what people are watching ---

export type NowWatching = {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  tmdb_id: number;
  media_type: "movie" | "tv";
  season_number: number | null;
  episode_number: number | null;
  title: string | null;
  poster_path: string | null;
  position_seconds: number;
  duration_seconds: number;
  playing: boolean;
  since: string;
  last_beat: string;
};
export type HistoryItem = {
  tmdb_id: number;
  media_type: "movie" | "tv";
  season_number: number | null;
  episode_number: number | null;
  title: string | null;
  poster_path: string | null;
  position_seconds: number;
  duration_seconds: number;
  fraction: number | null;
  opened_only: boolean;
  updated_at: string;
};
export type HistoryPage = { items: HistoryItem[]; total: number };
export type WatchlistEntry = { tmdb_id: number; media_type: "movie" | "tv"; title: string | null; poster_path: string | null; added_at: string };
export type UserDetail = { user: AdminUser; now_watching: NowWatching | null; active_sessions: number; last_activity: string | null };

export const getNowWatching = () => request<NowWatching[]>("/now-watching", {}, "Couldn't load who is watching.");
export const getUserDetail = (id: string) => request<UserDetail>(`/users/${id}/detail`, {}, "Couldn't load that person.");
export const getUserHistory = (id: string, offset = 0, limit = 50) =>
  request<HistoryPage>(`/users/${id}/history?limit=${limit}&offset=${offset}`, {}, "Couldn't load the watch history.");
export const getUserWatchlist = (id: string) => request<WatchlistEntry[]>(`/users/${id}/watchlist`, {}, "Couldn't load their list.");

// --- Phase 10b: drill-down lists ---

export type TitleRow = {
  tmdb_id: number;
  media_type: "movie" | "tv";
  title: string | null;
  poster_path: string | null;
  viewers: number;
  entries: number;
  last_watched_at: string;
};
export type TitlePage = { items: TitleRow[]; total: number };
export type ViewerItem = HistoryItem & { user_id: string; username: string; display_name: string; avatar_url: string | null };
export type ViewerPage = { items: ViewerItem[]; total: number };
export type LoginRow = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  is_disabled: boolean;
  last_login_at: string | null;
  active_sessions: number;
};

export const getTitlesWatched = (offset = 0, limit = 50) =>
  request<TitlePage>(`/titles?limit=${limit}&offset=${offset}`, {}, "Couldn't load the titles.");
export const getTitleViewers = (mediaType: "movie" | "tv", tmdbId: number, offset = 0, limit = 50) =>
  request<ViewerPage>(`/titles/${mediaType}/${tmdbId}/viewers?limit=${limit}&offset=${offset}`, {}, "Couldn't load who watched that.");
export const getDayActivity = (day: string, offset = 0, limit = 50) =>
  request<ViewerPage>(`/activity/${day}?limit=${limit}&offset=${offset}`, {}, "Couldn't load that day.");
export const getSignIns = () => request<LoginRow[]>("/sign-ins", {}, "Couldn't load the sign-ins.");

// --- Phase 10c: messages ("I understand") ---

export type AnnouncementStatus = "active" | "expired" | "stopped";
export type Announcement = {
  id: string;
  title: string;
  body: string;
  audience: "all" | "selected";
  created_at: string;
  created_by_name: string | null;
  expires_at: string | null;
  is_active: boolean;
  status: AnnouncementStatus;
  recipients: number;
  accepted: number;
};
export type AnnouncementPerson = { user_id: string; username: string; display_name: string; avatar_url: string | null; acked_at: string | null };
export type AnnouncementDetail = Announcement & { people: AnnouncementPerson[] };
export type AnnouncementInput = {
  title: string;
  body: string;
  audience: "all" | "selected";
  user_ids: string[];
  expires_at: string | null;
};

export const listAnnouncements = () => request<Announcement[]>("/announcements", {}, "Couldn't load the messages.");
export const getAnnouncement = (id: string) => request<AnnouncementDetail>(`/announcements/${id}`, {}, "Couldn't load that message.");
export const getAnnouncementTargets = (id: string) => request<string[]>(`/announcements/${id}/targets`, {}, "Couldn't load who it's for.");
export const createAnnouncement = (body: AnnouncementInput) =>
  request<Announcement>("/announcements", { method: "POST", body: JSON.stringify(body) }, "Couldn't send that message.");
export const updateAnnouncement = (id: string, body: Partial<AnnouncementInput> & { is_active?: boolean }) =>
  request<Announcement>(`/announcements/${id}`, { method: "PATCH", body: JSON.stringify(body) }, "Couldn't save the changes.");
export const reshowAnnouncement = (id: string) =>
  request<{ cleared: number }>(`/announcements/${id}/reshow`, { method: "POST" }, "Couldn't show it again.");
export const deleteAnnouncement = (id: string) => request<void>(`/announcements/${id}`, { method: "DELETE" }, "Couldn't delete that message.");

// --- Phase 10d: audit trail ---

export type AuditEntry = {
  id: string;
  at: string;
  actor_id: string | null;
  actor_name: string;
  action: string;
  target_user_id: string | null;
  target_name: string | null;
  detail: string | null;
};
export type AuditPage = { items: AuditEntry[]; total: number };
export type SignInEntry = { id: string; at: string; user_id: string; username: string; display_name: string; avatar_url: string | null; device: string };
export type SignInPage = { items: SignInEntry[]; total: number };

export const getAuditTrail = (offset = 0, limit = 50) =>
  request<AuditPage>(`/audit?limit=${limit}&offset=${offset}`, {}, "Couldn't load the admin log.");
export const getSignInLog = (offset = 0, limit = 50) =>
  request<SignInPage>(`/sign-in-log?limit=${limit}&offset=${offset}`, {}, "Couldn't load the sign-in log.");
