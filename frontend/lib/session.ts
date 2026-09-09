import { cookies } from "next/headers";
import { getApiBaseUrl } from "@/lib/api-client";
import type { UserPublic } from "@/lib/auth";

/**
 * Reads the current user from within a Server Component.
 *
 * A server-side `fetch` doesn't automatically carry the browser's
 * cookies (it's a separate request from the Node process to the
 * backend) — so we read the incoming request's cookies via
 * `next/headers` and forward them explicitly.
 */
export async function getServerCurrentUser(): Promise<UserPublic | null> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();

  const res = await fetch(`${getApiBaseUrl()}/auth/me`, {
    headers: { Cookie: cookieHeader },
    cache: "no-store",
  });

  if (res.status === 401) return null;
  if (!res.ok) throw new Error("Failed to load current user");
  return res.json();
}
