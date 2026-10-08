import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AskAIPage from "@/components/AskAIPage";
import AskResultRow from "@/components/AskResultRow";
import Nav from "@/components/Nav";
import NavSearch from "@/components/NavSearch";
import AITab from "@/components/admin/AITab";
import UserDetailView from "@/components/admin/UserDetailView";
import { SettingsProvider } from "@/components/SettingsProvider";
import * as admin from "@/lib/admin";
import * as ai from "@/lib/ai";
import { resetAIAvailabilityCache } from "@/lib/use-ai-available";
import { DEFAULT_SETTINGS } from "@/lib/settings";

const nav = vi.hoisted(() => ({ push: vi.fn(), params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
  useSearchParams: () => nav.params,
  usePathname: () => "/",
}));
vi.mock("@/lib/ai", async (orig) => ({ ...(await orig<typeof import("@/lib/ai")>()), getAIStatus: vi.fn(), askAI: vi.fn() }));
const found = vi.hoisted(() => ({ results: [] as unknown[] }));
vi.mock("@/lib/useDebouncedSearch", () => ({ useDebouncedSearch: () => ({ results: found.results, loading: false, error: null }) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn(async () => ({ id: "u", username: "u", display_name: "Eve", is_admin: false, avatar_url: null })), onUserChanged: () => () => {} }));
vi.mock("@/components/UserMenu", () => ({ default: () => null }));
vi.mock("@/components/LogoutButton", () => ({ default: () => null }));
vi.mock("@/lib/watchlist", () => ({ addToWatchlist: vi.fn(async () => {}), removeFromWatchlist: vi.fn(async () => {}) }));
vi.mock("@/lib/toast", () => ({ showToast: vi.fn() }));
vi.mock("@/lib/admin", async (orig) => ({ ...(await orig<typeof import("@/lib/admin")>()), getUserDetail: vi.fn(), updateAdminUser: vi.fn(), setUserAIHistory: vi.fn(), getAdminAI: vi.fn(), saveAdminAIConfig: vi.fn(), getUserHistory: vi.fn(async () => ({ items: [], has_more: false })), getUserWatchlist: vi.fn(async () => ({ items: [], has_more: false })) }));

const title = (over: Partial<ai.AskTitle> = {}): ai.AskTitle => ({
  tmdb_id: 153, media_type: "movie", title: "Lost in Translation", year: "2003", overview: "Two lonely people in Tokyo.", genres: ["Drama", "Romance"],
  poster_path: "/p.jpg", backdrop_path: null, rating: 7.7, runtime_minutes: 102, seasons: null, trailer_key: "yt1", reason: "Quiet and tender", ...over,
});
const wrap = (ui: React.ReactNode) => render(<SettingsProvider initial={DEFAULT_SETTINGS}>{ui}</SettingsProvider>);
const status = (over: Partial<ai.AIStatus> = {}): ai.AIStatus => ({ enabled: true, limit: 5, used: 0, remaining: 5, ...over });

beforeEach(() => {
  nav.push.mockReset();
  resetAIAvailabilityCache();
  found.results = [];
  nav.params = new URLSearchParams();
  vi.mocked(ai.getAIStatus).mockReset().mockResolvedValue(status());
  vi.mocked(ai.askAI).mockReset();
});
afterEach(cleanup);

describe("looksLikeRequest", () => {
  it.each([
    ["im sad, i want a sad movie about a lonely girl", true],
    ["something funny for a rainy night", true],
    ["recommend me a thriller", true],
    ["inception", false],
    ["the dark knight", false],
    ["breaking bad s02", false],
  ])("%s", (text, expected) => expect(ai.looksLikeRequest(text)).toBe(expected));
});

describe("search box", () => {
  async function type(text: string) {
    const user = userEvent.setup();
    wrap(<NavSearch />);
    await user.type(screen.getByLabelText("Search"), text);
  }

  it("offers Ask AI for something that reads like a request, and Enter still does the normal search", async () => {
    await type("im sad, i want a sad movie about a lonely girl");
    const row = await screen.findByRole("button", { name: /Ask AI about/ });
    expect(row.className).toContain("bg-accent"); // a filled button, not a tip
    expect(row).toBeInTheDocument();
    fireEvent.click(row);
    expect(nav.push).toHaveBeenLastCalledWith(`/ask?q=${encodeURIComponent("im sad, i want a sad movie about a lonely girl")}`);
    fireEvent.keyDown(screen.getByLabelText("Search"), { key: "Enter" });
    expect(nav.push).toHaveBeenLastCalledWith(expect.stringMatching(/^\/search\?q=/));
  });

  it("keeps the small ✨ button for short searches that found something, but not the big row", async () => {
    found.results = [{ tmdb_id: 1, media_type: "movie", title: "Inception", year: "2010", poster_path: null, backdrop_path: null, rating: 8 }];
    await type("inception");
    expect(await screen.findByRole("button", { name: "Ask AI" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ask AI about/ })).toBeNull();
  });

  it("also offers it when nothing was found (a typo, say), with a wording that fits", async () => {
    await type("inceptoin");
    const button = await screen.findByRole("button", { name: /Ask AI about/ });
    expect(button).toHaveTextContent("find it for me");
    expect(screen.getByText(/Maybe a typo/)).toBeInTheDocument();
    cleanup();
    found.results = [{ tmdb_id: 1, media_type: "movie", title: "Inception", year: "2010", poster_path: null, backdrop_path: null, rating: 8 }];
    await type("inception");
    await screen.findByRole("button", { name: "Ask AI" });
    expect(screen.queryByRole("button", { name: /Ask AI about/ })).toBeNull();
  });

  it("offers nothing when the server has no key, or this person's AI is switched off", async () => {
    vi.mocked(ai.getAIStatus).mockResolvedValue(status({ enabled: false }));
    await type("something funny for a rainy night");
    await waitFor(() => expect(ai.getAIStatus).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /Ask AI/ })).toBeNull();
    cleanup();
    resetAIAvailabilityCache();
    vi.mocked(ai.getAIStatus).mockResolvedValue(status({ limit: 0, remaining: 0 }));
    await type("something funny for a rainy night");
    await waitFor(() => expect(ai.getAIStatus).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: /Ask AI/ })).toBeNull();
  });

  it("doesn't ask the server anything until someone types", () => {
    wrap(<NavSearch />);
    expect(ai.getAIStatus).not.toHaveBeenCalled();
  });
});

describe("header link", () => {
  it("Ask AI takes Home's place where it is available, and Home stays where it isn't", async () => {
    wrap(<Nav />);
    expect(await screen.findByRole("link", { name: "Ask AI" })).toHaveAttribute("href", "/ask");
    expect(screen.queryByRole("link", { name: "Home" })).toBeNull();
    cleanup();
    resetAIAvailabilityCache();
    vi.mocked(ai.getAIStatus).mockResolvedValue(status({ enabled: false }));
    wrap(<Nav />);
    expect(await screen.findByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("link", { name: "Ask AI" })).toBeNull();
  });
});

describe("Ask AI page", () => {
  it("says, quietly, that recent watches and the box are sent (or that they aren't)", () => {
    wrap(<AskAIPage />);
    expect(screen.getByText(/Uses what you recently watched and what's in .* for better picks/)).toBeInTheDocument();
    cleanup();
    render(<SettingsProvider initial={{ ...DEFAULT_SETTINGS, ai: { use_history: false } }}><AskAIPage /></SettingsProvider>);
    expect(screen.getByText(/Not using your watch history/)).toBeInTheDocument();
  });

  const answer = (over: Partial<ai.AskResponse> = {}): ai.AskResponse => ({
    note: null, for_you: [title()], general: [title({ tmdb_id: 152, title: "Her", year: "2013" })], used_history: true, remaining: 4, limit: 5, ...over,
  });

  it("asks straight away from the address, shows two tabs, the note and what is left", async () => {
    nav.params = new URLSearchParams({ q: "a sad film" });
    vi.mocked(ai.askAI).mockResolvedValue(answer({ note: "Leaning gentle." }));
    wrap(<AskAIPage />);
    expect(ai.askAI).toHaveBeenCalledWith("a sad film");
    expect(await screen.findByRole("article", { name: "Lost in Translation" })).toBeInTheDocument();
    expect(screen.getByText("Leaning gentle.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Anything like this/ }));
    expect(screen.getByRole("article", { name: "Her" })).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "Lost in Translation" })).toBeNull();
    await waitFor(() => expect(screen.getByText("4 AI searches left today")).toBeInTheDocument());
  });

  it("shows no tabs and a hint when there are no personal picks", async () => {
    nav.params = new URLSearchParams({ q: "a sad film" });
    vi.mocked(ai.askAI).mockResolvedValue(answer({ for_you: [], used_history: false }));
    wrap(<AskAIPage />);
    expect(await screen.findByRole("article", { name: "Her" })).toBeInTheDocument();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("shows the reason and a normal-search way out when it fails", async () => {
    nav.params = new URLSearchParams({ q: "a sad film" });
    vi.mocked(ai.askAI).mockRejectedValue(new Error("You've used your 5 AI searches for today. They come back tomorrow."));
    wrap(<AskAIPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("5 AI searches for today");
    expect(screen.getByRole("link", { name: /search for “a sad film”/ })).toHaveAttribute("href", "/search?q=a%20sad%20film");
  });

  it("an admin sees no counter, and the form sends the new request through the address", async () => {
    vi.mocked(ai.getAIStatus).mockResolvedValue(status({ limit: null, remaining: null }));
    wrap(<AskAIPage />);
    await waitFor(() => expect(ai.getAIStatus).toHaveBeenCalled());
    expect(screen.queryByText(/left today/)).toBeNull();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("What do you feel like watching?"), "a cozy mystery");
    await user.click(screen.getByRole("button", { name: "Ask" }));
    expect(nav.push).toHaveBeenCalledWith("/ask?q=a%20cozy%20mystery");
    expect(ai.askAI).not.toHaveBeenCalled();
  });
});

describe("AskResultRow", () => {
  it("shows what a detail page shows, plus the actions", async () => {
    wrap(<AskResultRow item={title()} />);
    const row = screen.getByRole("article", { name: "Lost in Translation" });
    expect(row).toHaveTextContent("2003 · 102 min · Movie");
    for (const text of ["Drama", "Romance", "Quiet and tender", "Two lonely people in Tokyo."]) expect(within(row).getByText(text)).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Show all ratings" })).toHaveTextContent("7.7");
    expect(within(row).getByRole("button", { name: /Watch trailer/ })).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: /Watch now/ })).toHaveAttribute("href", "/watch/movie/153");
    fireEvent.click(within(row).getByRole("button", { name: /^\+/ }));
    await waitFor(() => expect(within(row).getByRole("button", { name: /^✓ In/ })).toBeInTheDocument());
  });

  it("a series shows its seasons and starts at episode one; no trailer button without a trailer", () => {
    wrap(<AskResultRow item={title({ media_type: "tv", tmdb_id: 85552, title: "Station Eleven", runtime_minutes: null, seasons: 1, trailer_key: null })} />);
    const row = screen.getByRole("article", { name: "Station Eleven" });
    expect(row).toHaveTextContent("1 season · TV");
    expect(within(row).getByRole("link", { name: /Watch now/ })).toHaveAttribute("href", "/watch/tv/85552/1/1");
    expect(within(row).queryByRole("button", { name: /Watch trailer/ })).toBeNull();
  });
});

describe("admin: AI searches a day", () => {
  const person = (over: Partial<admin.AdminUser> = {}): admin.UserDetail => ({
    user: { id: "u1", username: "bob", display_name: "Bob", is_admin: false, is_disabled: false, created_at: "2026-01-01T00:00:00Z", last_login_at: null, avatar_url: null, watchlist_count: 0, watched_count: 0, ai_daily_limit: null, ai_use_history: true, ...over },
    now_watching: null, active_sessions: 0, last_activity: null,
  });

  it("sets a number, switches AI off, and goes back to the usual", async () => {
    vi.mocked(admin.getUserDetail).mockResolvedValue(person());
    vi.mocked(admin.updateAdminUser).mockImplementation(async (_id, body) => person({ ai_daily_limit: body.ai_daily_limit ?? null }).user);
    const user = userEvent.setup();
    render(<UserDetailView userId="u1" onBack={() => {}} />);
    const box = await screen.findByLabelText("AI searches a day");
    await user.type(box, "12");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(admin.updateAdminUser).toHaveBeenLastCalledWith("u1", { ai_daily_limit: 12 }));
    expect(await screen.findByText("This person gets 12 a day.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Switch off" }));
    await waitFor(() => expect(admin.updateAdminUser).toHaveBeenLastCalledWith("u1", { ai_daily_limit: 0 }));
    expect(await screen.findByText("Ask AI is switched off for this person.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Use the usual" }));
    await waitFor(() => expect(admin.updateAdminUser).toHaveBeenLastCalledWith("u1", { ai_daily_limit: null }));
  });

  it("says admins have no limit", async () => {
    vi.mocked(admin.getUserDetail).mockResolvedValue(person({ is_admin: true }));
    render(<UserDetailView userId="u1" onBack={() => {}} />);
    expect(await screen.findByText("Admins have no limit.")).toBeInTheDocument();
    expect(screen.queryByLabelText("AI searches a day")).toBeNull();
  });
});

describe("admin: AI history and the AI tab", () => {
  const detail = (use: boolean): admin.UserDetail => ({
    user: { id: "u1", username: "bob", display_name: "Bob", is_admin: false, is_disabled: false, created_at: "2026-01-01T00:00:00Z", last_login_at: null, avatar_url: null, watchlist_count: 0, watched_count: 0, ai_daily_limit: null, ai_use_history: use },
    now_watching: null, active_sessions: 0, last_activity: null,
  });

  it("a person's page has a watch-history switch that saves", async () => {
    vi.mocked(admin.getUserDetail).mockResolvedValue(detail(true));
    vi.mocked(admin.setUserAIHistory).mockResolvedValue(detail(false).user);
    render(<UserDetailView userId="u1" onBack={() => {}} />);
    const box = await screen.findByLabelText("Use watch history for AI");
    expect(box).toBeChecked();
    await userEvent.setup().click(box);
    await waitFor(() => expect(admin.setUserAIHistory).toHaveBeenCalledWith("u1", false));
    await waitFor(() => expect(screen.getByLabelText("Use watch history for AI")).not.toBeChecked());
  });

  const overview = (over: Partial<admin.AdminAIOverview> = {}): admin.AdminAIOverview => ({
    key_configured: true, model: "gemini-3.5-flash", enabled: true, default_daily_limit: 5, asks_today: 7,
    users: [
      { id: "a", username: "root", display_name: "Root", is_admin: true, ai_daily_limit: null, effective_limit: null, used_today: 4, use_history: true },
      { id: "b", username: "bob", display_name: "Bob", is_admin: false, ai_daily_limit: 2, effective_limit: 2, used_today: 2, use_history: true },
    ], ...over,
  });

  it("shows the key, today's total and each person, and saves the site-wide settings", async () => {
    vi.mocked(admin.getAdminAI).mockResolvedValue(overview());
    vi.mocked(admin.saveAdminAIConfig).mockResolvedValue(overview({ default_daily_limit: 8, enabled: false }));
    const user = userEvent.setup();
    render(<AITab />);
    expect(await screen.findByText("API key set · gemini-3.5-flash")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText(/4 used today · No limit/)).toBeInTheDocument();
    expect(screen.getByText(/2 used today · 2 a day \(their own\)/)).toBeInTheDocument();
    const limit = screen.getByLabelText("Usual AI searches a day");
    await user.clear(limit);
    await user.type(limit, "8");
    await user.click(screen.getByLabelText("Ask AI is on"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(admin.saveAdminAIConfig).toHaveBeenCalledWith({ enabled: false, default_daily_limit: 8 }));
  });

  it("flips one person's history use from the list, and says when there is no key", async () => {
    vi.mocked(admin.getAdminAI).mockResolvedValue(overview({ key_configured: false }));
    vi.mocked(admin.setUserAIHistory).mockResolvedValue(detail(false).user);
    render(<AITab />);
    expect(await screen.findByText(/No API key/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByLabelText("Use watch history for Bob"));
    await waitFor(() => expect(admin.setUserAIHistory).toHaveBeenCalledWith("b", false));
    await waitFor(() => expect(screen.getByLabelText("Use watch history for Bob")).not.toBeChecked());
  });
});
