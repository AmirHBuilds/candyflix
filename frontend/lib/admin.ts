/** Client for /api/admin (admins only). */
import { fetchWithTimeout, getApiBaseUrl } from "@/lib/api-client";

import type { AgeLimit } from "@/lib/age-limit";

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
  /** AI searches a day; null = the site default, 0 = off. Admins are never limited. */
  ai_daily_limit: number | null;
  /** The same, for the watch assistant in the player. */
  watch_ai_daily_limit: number | null;
  /** Highest age rating they may watch; null = no limit. */
  age_limit: AgeLimit | null;
  /** Two-step sign-in (a code from the Telegram bot) is on for them. */
  two_factor_enabled: boolean;
  /** Their own Settings switch: Ask AI may use their watch history and box. */
  ai_use_history: boolean;
  /** An admin muted them: they can read opinions but not write any. */
  opinions_blocked?: boolean;
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
  gemini: ServiceCheck;
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
export const createAdminUser = (body: { username: string; display_name: string; password: string; is_admin: boolean; age_limit?: AgeLimit | null }) =>
  request<AdminUser>("/users", { method: "POST", body: JSON.stringify(body) }, "Couldn't create that user.");
export const updateAdminUser = (
  id: string,
  body: Partial<{ username: string; display_name: string; is_admin: boolean; is_disabled: boolean; ai_daily_limit: number | null; watch_ai_daily_limit: number | null; age_limit: AgeLimit | null; opinions_blocked: boolean }>
) => request<AdminUser>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }, "Couldn't save the changes.");
export const resetAdminPassword = (id: string, newPassword: string) =>
  request<void>(`/users/${id}/password`, { method: "POST", body: JSON.stringify({ new_password: newPassword }) }, "Couldn't reset the password.");
export const switchOffTwoFactor = (id: string) =>
  request<AdminUser>(`/users/${id}/2fa-off`, { method: "POST" }, "Couldn't switch that off.");
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
export type SignInEntry = { id: string; at: string; user_id: string; username: string; display_name: string; avatar_url: string | null; device: string; ip?: string | null; user_agent?: string | null };
export type SignInPage = { items: SignInEntry[]; total: number };

export const getAuditTrail = (offset = 0, limit = 50) =>
  request<AuditPage>(`/audit?limit=${limit}&offset=${offset}`, {}, "Couldn't load the admin log.");
export const getSignInLog = (offset = 0, limit = 50) =>
  request<SignInPage>(`/sign-in-log?limit=${limit}&offset=${offset}`, {}, "Couldn't load the sign-in log.");

export const getAdminBanners = () => request<import("@/lib/site").HomeBannersContent>("/banners", {}, "Couldn't load the banners.");
export const saveAdminBanners = (body: import("@/lib/site").HomeBannersContent) =>
  request<import("@/lib/site").HomeBannersContent>("/banners", { method: "PUT", body: JSON.stringify(body) }, "Couldn't save the banners.");

export type AdminAIUser = {
  id: string;
  username: string;
  display_name: string;
  is_admin: boolean;
  ai_daily_limit: number | null;
  /** What applies today; null = no limit. */
  effective_limit: number | null;
  used_today: number;
  watch_ai_daily_limit: number | null;
  watch_effective_limit: number | null;
  watch_used_today: number;
  use_history: boolean;
};
export type AdminAIOverview = {
  key_configured: boolean;
  model: string;
  enabled: boolean;
  default_daily_limit: number;
  asks_today: number;
  watch_enabled: boolean;
  watch_daily_limit: number;
  watch_asks_today: number;
  models: { model: string; paused_seconds: number }[];
  users: AdminAIUser[];
};

export const getAdminAI = () => request<AdminAIOverview>("/ai", {}, "Couldn't load the AI settings.");
export const saveAdminAIConfig = (body: { enabled: boolean; default_daily_limit: number; watch_enabled: boolean; watch_daily_limit: number }) =>
  request<AdminAIOverview>("/ai/config", { method: "PUT", body: JSON.stringify(body) }, "Couldn't save the AI settings.");
export const clearAIPauses = () => request<{ ok: boolean }>("/ai/pauses", { method: "DELETE" }, "Couldn't do that.");
export const setUserAIHistory = (id: string, use_history: boolean) =>
  request<AdminUser>(`/users/${id}/ai-history`, { method: "PUT", body: JSON.stringify({ use_history }) }, "Couldn't save that.");

export type AISearchRow = { prompt: string; results: number; used_history: boolean; created_at: string };
export type AISearchPage = { items: AISearchRow[]; total: number };
export const getUserAISearches = (id: string, offset = 0, limit = 50) =>
  request<AISearchPage>(`/users/${id}/ai-searches?limit=${limit}&offset=${offset}`, {}, "Couldn't load their AI searches.");

// --- The crown on admins' profiles (login screen) ---
export const getAdminBadge = () => request<import("@/lib/site").BadgeContent>("/badge", {}, "Couldn't load the badge.");
export const saveAdminBadgePosition = (position: import("@/lib/site").BadgePosition) =>
  request<import("@/lib/site").BadgeContent>("/badge", { method: "PUT", body: JSON.stringify({ position }) }, "Couldn't save that.");
export const removeAdminBadgeImage = () =>
  request<import("@/lib/site").BadgeContent>("/badge/image", { method: "DELETE" }, "Couldn't go back to the crown.");
export async function uploadAdminBadgeImage(file: File): Promise<import("@/lib/site").BadgeContent> {
  const form = new FormData(); // no JSON header: the browser sets the multipart one
  form.append("file", file);
  const res = await fetchWithTimeout(`${getApiBaseUrl()}/admin/badge/image`, { method: "PUT", credentials: "include", body: form }, 60_000);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body?.detail === "string" ? body.detail : "Couldn't upload that picture.");
  }
  return res.json();
}

// --- Phase 21: opinions moderation ---

export type SocialConfig = { enabled: boolean; allow_anonymous: boolean; allow_replies: boolean; home_section: boolean };
export type AdminOpinion = {
  id: string;
  body: string;
  created_at: string;
  author_id: string;
  author_name: string;
  is_anonymous: boolean;
  hidden: boolean;
  is_reply: boolean;
  media_type: "movie" | "tv";
  tmdb_id: number;
  season_number: number;
  episode_number: number;
  title: string | null;
  likes: number;
};
export type AdminOpinionPage = { items: AdminOpinion[]; total: number };

export const getSocialConfig = () => request<SocialConfig>("/social", {}, "Couldn't load the switches.");
export const saveSocialConfig = (body: SocialConfig) =>
  request<SocialConfig>("/social", { method: "PUT", body: JSON.stringify(body) }, "Couldn't save the switches.");
export const listAdminOpinions = (offset = 0, hidden = false, limit = 30, userId?: string) =>
  request<AdminOpinionPage>(`/opinions?offset=${offset}&limit=${limit}&hidden=${hidden}${userId ? `&user_id=${userId}` : ""}`, {}, "Couldn't load opinions.");
export const hideAdminOpinion = (id: string, hide: boolean) =>
  request<void>(`/opinions/${id}/${hide ? "hide" : "unhide"}`, { method: "POST" }, "Couldn't change that.");
export const deleteAdminOpinion = (id: string) => request<void>(`/opinions/${id}`, { method: "DELETE" }, "Couldn't delete that.");

export type AdminFeedback = {
  id: string;
  kind: "problem" | "idea" | "other";
  message: string;
  page: string | null;
  device: string | null;
  created_at: string;
  handled: boolean;
  author_id: string | null;
  author_name: string;
};
export type AdminFeedbackPage = { items: AdminFeedback[]; total: number; unhandled: number };
export const listFeedback = (offset = 0, handled?: boolean, limit = 30) =>
  request<AdminFeedbackPage>(`/feedback?offset=${offset}&limit=${limit}${handled === undefined ? "" : `&handled=${handled}`}`, {}, "Couldn't load feedback.");
export const markFeedback = (id: string, handled: boolean) =>
  request<void>(`/feedback/${id}/handled?handled=${handled}`, { method: "POST" }, "Couldn't change that.");
export const deleteFeedback = (id: string) => request<void>(`/feedback/${id}`, { method: "DELETE" }, "Couldn't delete that.");

export type PlaybackConfig = { prefetch_next_episode: boolean };
export const getPlaybackConfig = () => request<PlaybackConfig>("/playback", {}, "Couldn't load the playback switch.");
export const savePlaybackConfig = (body: PlaybackConfig) =>
  request<PlaybackConfig>("/playback", { method: "PUT", body: JSON.stringify(body) }, "Couldn't save the playback switch.");

// ---------- error log ----------
export type ErrorSource = "server" | "ai" | "resolver" | "sync" | "subtitles" | "tmdb" | "browser" | "system";
export type AdminError = {
  id: string;
  created_at: string;
  last_seen: string;
  count: number;
  source: ErrorSource | string;
  level: "error" | "warning";
  title: string;
  detail: string | null;
  where: string | null;
  user_name: string | null;
  handled: boolean;
};
export type AdminErrorPage = { items: AdminError[]; total: number; unhandled: number; last_24h: number; by_source: Record<string, number> };
export type ErrorQuery = { offset?: number; source?: string; level?: string; handled?: boolean; q?: string };
export const listErrors = ({ offset = 0, source, level, handled, q }: ErrorQuery = {}) => {
  const p = new URLSearchParams({ offset: String(offset), limit: "30" });
  if (source) p.set("source", source);
  if (level) p.set("level", level);
  if (handled !== undefined) p.set("handled", String(handled));
  if (q) p.set("q", q);
  return request<AdminErrorPage>(`/errors?${p}`, {}, "Couldn't load the error log.");
};
export const markError = (id: string, handled: boolean) => request<AdminError>(`/errors/${id}/handled?handled=${handled}`, { method: "POST" }, "Couldn't change that.");
export const deleteError = (id: string) => request<void>(`/errors/${id}`, { method: "DELETE" }, "Couldn't delete that.");
export const handleAllErrors = (source?: string) => request<{ changed: number }>(`/errors/handle-all${source ? `?source=${source}` : ""}`, { method: "POST" }, "Couldn't change that.");
export const clearHandledErrors = () => request<{ cleared: number }>("/errors/clear-handled", { method: "POST" }, "Couldn't clear them.");

// ---------- the server itself ----------
export type HostStatus = {
  memory: { total: number; available: number; used: number; swap_total: number; swap_used: number; limit?: number; container_used?: number } | null;
  cpu: { cores: number; load_1: number; load_5: number; load_15: number } | null;
  uptime: { host_seconds: number | null; app_seconds: number; app_memory: number | null };
  disks: { label: string; path: string; total: number; used: number; free: number }[];
  folders: { label: string; files: number; bytes: number }[];
  database: { bytes: number; connections: number } | null;
  redis: { bytes: number; keys: number } | null;
  resolver: { ok: boolean; detail: string; latency_ms: number | null } | null;
  watching_now: number;
};
export const getHostStatus = () => request<HostStatus>("/system/host", {}, "Couldn't read the server's numbers.");

// ---------- is an account being shared? ----------
export type SharingIP = { ip: string; sign_ins: number; first_at: string; last_at: string; devices: string[] };
export type SharingPerson = {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  is_disabled: boolean;
  distinct_ips: number;
  sign_ins: number;
  flagged: boolean;
  ips: SharingIP[];
};
export type SharingOverview = { window_hours: number; max_ips: number; enabled: boolean; people: SharingPerson[] };
export type SharingConfig = { enabled: boolean; max_ips: number; window_hours: number };
export const getSharing = () => request<SharingOverview>("/security/sharing", {}, "Couldn't check the sign-in addresses.");
export const getSharingConfig = () => request<SharingConfig>("/security/sharing-config", {}, "Couldn't load the account-sharing settings.");
export const saveSharingConfig = (body: SharingConfig) =>
  request<SharingConfig>("/security/sharing-config", { method: "PUT", body: JSON.stringify(body) }, "Couldn't save the account-sharing settings.");

// ---------- notices for admins ----------
export type AdminNotice = { id: string; at: string; kind: "feedback" | "sharing" | string; title: string; body: string | null; link: string | null; user_id: string | null; user_name: string | null; unread: boolean };
export type AdminNotices = { items: AdminNotice[]; unread: number; resting: boolean; rest_until: string | null; rest_forever: boolean; server_time: string };
export const getNotices = () => request<AdminNotices>("/notices", {}, "Couldn't load the notices.");
export const markNoticesRead = () => request<void>("/notices/read", { method: "POST" }, "Couldn't mark them as read.");
/** minutes: 0 = stop resting, a number = rest that long, null = rest until switched off. */
export const setRest = (minutes: number | null) => request<AdminNotices>("/notices/rest", { method: "PUT", body: JSON.stringify({ minutes }) }, "Couldn't change rest mode.");
