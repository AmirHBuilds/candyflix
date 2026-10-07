import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomeBanner from "@/components/HomeBanner";
import BannersTab from "@/components/admin/BannersTab";
import * as admin from "@/lib/admin";
import { DEFAULT_BANNERS, type HomeBannersContent } from "@/lib/site";

vi.mock("@/lib/admin", () => ({ getAdminBanners: vi.fn(), saveAdminBanners: vi.fn() }));
vi.mock("@/lib/toast", () => ({ showToast: vi.fn() }));
vi.mock("@/lib/media", async (orig) => {
  const items = (n: string) => [{ tmdb_id: 1, media_type: "movie", title: `${n} item`, year: "2026", poster_path: "/p.jpg", backdrop_path: null, rating: 7 }];
  return {
    ...(await orig<typeof import("@/lib/media")>()),
    getTrending: vi.fn(async (w: string) => items(w === "day" ? "Today" : "Week")),
    getPopularMovies: vi.fn(async () => items("Movies")),
    getPopularTV: vi.fn(async () => items("Shows")),
  };
});
vi.mock("@/lib/continue-watching-server", () => ({ getContinueWatchingServer: vi.fn(async () => ({ items: [], hasMore: false })) }));
vi.mock("@/lib/settings-server", async () => {
  const { DEFAULT_SETTINGS } = await import("@/lib/settings");
  return { getServerSettings: vi.fn(async () => DEFAULT_SETTINGS) };
});
vi.mock("@/components/HeroCarousel", () => ({ default: () => null }));
vi.mock("@/lib/site", async (orig) => ({ ...(await orig<typeof import("@/lib/site")>()), getBannersServer: vi.fn() }));
import { getBannersServer } from "@/lib/site";
import Home from "@/app/(main)/page";

afterEach(cleanup);

describe("home page banners", () => {
  async function order() {
    const { container } = render(await Home());
    return Array.from(container.querySelectorAll("section, aside")).map((n) => (n.tagName === "ASIDE" ? `banner${n.getAttribute("data-banner")}` : n.querySelector("h2")?.textContent));
  }

  it("puts a banner after each of the first three rows (Continue Watching is empty here, so Trending Today is the first row)", async () => {
    vi.mocked(getBannersServer).mockResolvedValue(DEFAULT_BANNERS);
    expect(await order()).toEqual(["Trending Today", "banner0", "Trending This Week", "banner1", "Popular Movies", "banner2", "Popular TV Shows"]);
  });

  it("leaves out a banner the admin switched off", async () => {
    vi.mocked(getBannersServer).mockResolvedValue({ banners: DEFAULT_BANNERS.banners.map((b, i) => ({ ...b, enabled: i !== 1 })) });
    expect(await order()).toEqual(["Trending Today", "banner0", "Trending This Week", "Popular Movies", "banner2", "Popular TV Shows"]);
  });
});

describe("HomeBanner", () => {
  it("shows the admin's words with a picture for each slot", () => {
    for (const slot of [0, 1, 2] as const) {
      const { container, unmount } = render(<HomeBanner banner={{ enabled: true, title: `Hi ${slot}`, text: "Some words" }} slot={slot} />);
      expect(screen.getByRole("heading", { name: `Hi ${slot}` })).toBeInTheDocument();
      expect(container.querySelector("svg")).not.toBeNull();
      unmount();
    }
  });
});

describe("BannersTab", () => {
  beforeEach(() => {
    vi.mocked(admin.getAdminBanners).mockReset().mockResolvedValue(DEFAULT_BANNERS);
    vi.mocked(admin.saveAdminBanners).mockReset().mockImplementation(async (b: HomeBannersContent) => b);
  });

  it("switches one off, edits another's words and saves all three", async () => {
    const user = userEvent.setup();
    render(<BannersTab />);
    const title = await screen.findByLabelText("Banner 2 title");
    await user.click(screen.getByRole("checkbox", { name: "Show banner 3" }));
    await user.clear(title);
    await user.type(title, "Hello there");
    await user.click(screen.getByRole("button", { name: "Save banners" }));
    await waitFor(() => expect(admin.saveAdminBanners).toHaveBeenCalled());
    const sent = vi.mocked(admin.saveAdminBanners).mock.calls[0][0];
    expect(sent.banners).toHaveLength(3);
    expect(sent.banners[1].title).toBe("Hello there");
    expect(sent.banners.map((b) => b.enabled)).toEqual([true, true, false]);
  });
});
