import { cookies } from "next/headers";

/**
 * For Server Components calling the media API: the browser's session cookie, so the backend knows who is
 * asking (what they may see depends on their age limit). Pass it as the last argument, e.g.
 * `getTrending("day", await authInit())`.
 */
export async function authInit(): Promise<RequestInit> {
  return { headers: { Cookie: (await cookies()).toString() } };
}
