import { NextRequest, NextResponse } from "next/server";

/**
 * Basic protected-route behavior: redirect to /login if there's no
 * session cookie at all. This is a fast, cheap first line of defense
 * (no network call) — it only checks whether a cookie is present, not
 * whether it's still valid server-side. Full validation happens where
 * it matters: Server Components call `getServerCurrentUser()` (see
 * lib/session.ts) and redirect if the backend says the session has
 * expired, and API routes are protected independently via
 * `get_current_user` on the backend regardless of what the frontend
 * does.
 */

const SESSION_COOKIE_NAME = "candyflix_session";
const PUBLIC_PATHS = ["/login"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  const hasSession = request.cookies.has(SESSION_COOKIE_NAME);
  if (!hasSession) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
