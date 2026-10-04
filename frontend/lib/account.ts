/** Client for /api/account — the signed-in person's own profile. */
import { fetchWithTimeout, getApiBaseUrl } from "@/lib/api-client";
import { notifyUserChanged, type UserPublic } from "@/lib/auth";

async function fail(res: Response, fallback: string): Promise<never> {
  const body = await res.json().catch(() => ({}));
  const detail = body?.detail;
  // 422s carry a list of validation problems; show the first one's message.
  const message =
    typeof detail === "string" ? detail : Array.isArray(detail) ? detail[0]?.msg?.replace(/^Value error, /, "") : null;
  throw new Error(message || fallback);
}

export async function updateDisplayName(displayName: string): Promise<UserPublic> {
  const res = await fetchWithTimeout(`${getApiBaseUrl()}/account/profile`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ display_name: displayName }),
  });
  if (!res.ok) await fail(res, "Couldn't save your name.");
  notifyUserChanged();
  return res.json();
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const res = await fetchWithTimeout(`${getApiBaseUrl()}/account/password`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
  if (!res.ok) await fail(res, "Couldn't change your password.");
}

export async function uploadAvatar(file: File): Promise<UserPublic> {
  const form = new FormData();
  form.append("file", file);
  // Uploads can legitimately take a while on a slow connection.
  const res = await fetchWithTimeout(
    `${getApiBaseUrl()}/account/avatar`,
    { method: "PUT", credentials: "include", body: form },
    60_000
  );
  if (!res.ok) await fail(res, "Couldn't upload that picture.");
  notifyUserChanged();
  return res.json();
}

export async function removeAvatar(): Promise<UserPublic> {
  const res = await fetchWithTimeout(`${getApiBaseUrl()}/account/avatar`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) await fail(res, "Couldn't remove your picture.");
  notifyUserChanged();
  return res.json();
}
