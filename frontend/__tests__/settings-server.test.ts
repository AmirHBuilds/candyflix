import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ toString: () => "candyflix_session=abc" }) }));

import { getServerSettings } from "@/lib/settings-server";
import { DEFAULT_SETTINGS } from "@/lib/settings";

afterEach(() => vi.unstubAllGlobals());

describe("getServerSettings", () => {
  it("forwards the visitor's session cookie and returns their settings", async () => {
    const mine = { ...DEFAULT_SETTINGS, appearance: { ...DEFAULT_SETTINGS.appearance, theme: "mint" } };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(mine), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await getServerSettings()).toEqual(mine);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/settings$/),
      expect.objectContaining({ headers: { Cookie: "candyflix_session=abc" }, cache: "no-store" })
    );
  });

  it.each([401, 500])("falls back to the defaults on HTTP %i instead of breaking the page", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status })));
    expect(await getServerSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("falls back to the defaults when the backend is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    expect(await getServerSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
