import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isValidElement, type ReactElement } from "react";

const redirect = vi.fn((to: string) => {
  throw new Error(`REDIRECT:${to}`);
});
vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirect(to),
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/session", () => ({ getServerCurrentUser: vi.fn() }));
vi.mock("@/lib/settings-server", () => ({ getServerSettings: vi.fn() }));
vi.mock("@/components/Nav", () => ({ default: () => null }));

import MainLayout from "@/app/(main)/layout";
import WatchLayout from "@/app/watch/layout";
import { SettingsProvider } from "@/components/SettingsProvider";
import { getServerCurrentUser } from "@/lib/session";
import { getServerSettings } from "@/lib/settings-server";
import { DEFAULT_SETTINGS } from "@/lib/settings";

const user = { id: "1", username: "candy", display_name: "Candy", created_at: "x" };
const mint = { ...DEFAULT_SETTINGS, appearance: { ...DEFAULT_SETTINGS.appearance, theme: "mint" as const } };

beforeEach(() => vi.clearAllMocks());

describe.each([
  ["(main) layout", MainLayout],
  ["watch layout", WatchLayout],
])("%s", (_name, Layout) => {
  it("wraps the page in the SettingsProvider, seeded with the server's settings", async () => {
    vi.mocked(getServerCurrentUser).mockResolvedValue(user);
    vi.mocked(getServerSettings).mockResolvedValue(mint);

    const tree = (await Layout({ children: "page" })) as ReactElement<{ initial: unknown }>;

    expect(isValidElement(tree)).toBe(true);
    expect(tree.type).toBe(SettingsProvider);
    expect(tree.props.initial).toEqual(mint);
  });

  it("still sends a signed-out visitor to the login screen", async () => {
    vi.mocked(getServerCurrentUser).mockResolvedValue(null);
    vi.mocked(getServerSettings).mockResolvedValue(DEFAULT_SETTINGS);

    await expect(Layout({ children: "page" })).rejects.toThrow("REDIRECT:/login");
  });

  it("looks up the user and the settings together, not one after the other", async () => {
    let releaseUser!: (u: typeof user) => void;
    vi.mocked(getServerCurrentUser).mockReturnValue(new Promise((r) => (releaseUser = r)));
    vi.mocked(getServerSettings).mockResolvedValue(DEFAULT_SETTINGS);

    const pending = Layout({ children: "page" });
    await new Promise((r) => setTimeout(r, 0));

    expect(getServerSettings).toHaveBeenCalledTimes(1); // started while the user lookup was still pending
    releaseUser(user);
    await pending;
  });
});

describe("the player uses the seek-time setting", () => {
  const source = readFileSync(join(__dirname, "..", "components/player/VideoPlayer.tsx"), "utf8");

  it("has no hard-coded skip lengths left", () => {
    expect(source).not.toMatch(/SKIP_SECONDS|SEEK_STEP_SECONDS/);
  });

  it("reads playback.seek_seconds and uses it for arrows, J/L and the double-tap zones", () => {
    expect(source).toContain("settings.playback.seek_seconds");
    expect(source).toMatch(/seekBy\(-seekSeconds\)/);
    expect(source).toMatch(/seekBy\(seekSeconds\)/);
    expect(source).toContain('zone === "left" ? -seekSeconds : seekSeconds');
  });

  it("the on-screen pulse shows the real amount, not a fixed '10s'", () => {
    expect(source).toContain("{seekSeconds}s</span>");
    expect(source).not.toContain('<span className="text-xs">10s</span>');
  });
});
