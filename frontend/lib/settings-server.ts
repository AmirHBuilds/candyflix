import * as React from "react";
import { cookies } from "next/headers";
import { getApiBaseUrl, fetchWithTimeout } from "@/lib/api-client";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings";

/**
 * The signed-in person's settings, for Server Component layouts.
 *
 * Never throws: settings are a nicety, so if the lookup fails (backend
 * hiccup, timeout) the page still renders — with the defaults — instead
 * of turning every page into an error screen.
 */
async function fetchServerSettings(): Promise<Settings> {
  try {
    const cookieStore = await cookies();
    const res = await fetchWithTimeout(`${getApiBaseUrl()}/settings`, {
      headers: { Cookie: cookieStore.toString() },
      cache: "no-store",
    });
    if (!res.ok) return DEFAULT_SETTINGS;
    return (await res.json()) as Settings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

// The root layout and the (main)/watch layouts both need the settings; within
// one request this makes it a single backend call. (`cache` only exists in
// the server build of React — elsewhere, e.g. in tests, it's a pass-through.)
const memoize: <T extends () => Promise<Settings>>(fn: T) => T =
  (React as unknown as { cache?: <T>(fn: T) => T }).cache ?? ((fn) => fn);

export const getServerSettings = memoize(fetchServerSettings);
