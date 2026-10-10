import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import OpinionsSection from "@/components/opinions/OpinionsSection";
import OpinionsStrip from "@/components/opinions/OpinionsStrip";
import CommunitySettingsForm from "@/components/settings/CommunitySettingsForm";
import { SettingsProvider } from "@/components/SettingsProvider";
import * as settingsLib from "@/lib/settings";
import * as lib from "@/lib/opinions";

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: (p: { alt: string }) => <img alt={p.alt} />,
}));
vi.mock("@/lib/settings", async () => {
  const actual = await vi.importActual<typeof settingsLib>("@/lib/settings");
  return { ...actual, getSettings: vi.fn(), patchSettings: vi.fn(), resetSettings: vi.fn() };
});
vi.mock("@/lib/opinions", async () => {
  const actual = await vi.importActual<typeof lib>("@/lib/opinions");
  return {
    ...actual,
    getTitleOpinions: vi.fn(),
    postOpinion: vi.fn(),
    deleteOpinion: vi.fn(),
    likeOpinion: vi.fn(),
    likeTitle: vi.fn(),
    getFeed: vi.fn(),
  };
});

const person = (name: string) => ({ id: name, name, avatar_url: null });
const op = (over: Partial<lib.Opinion> = {}): lib.Opinion => ({
  id: "o1", body: "Amazing, watch it!", created_at: new Date().toISOString(), author: person("Mom"), is_anonymous: false,
  mine: false, likes: 0, liked_by_me: false, real_author: null, hidden: false, replies: [], ...over,
});
const title = (over: Partial<lib.TitleOpinions> = {}): lib.TitleOpinions => ({
  enabled: true, moderator: false, can_comment: true, why_not: null, allow_anonymous: true, allow_replies: true, anonymous_default: false,
  likes: { count: 0, you_liked: false, people: [], more: 0 }, opinions: [], ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("likeSentence", () => {
  const L = (names: string[], more = 0, you = false) => ({ count: 0, you_liked: you, people: names.map(person), more });
  it("reads naturally", () => {
    expect(lib.likeSentence(L([]))).toBe("");
    expect(lib.likeSentence(L(["Candy"]))).toBe("Candy liked this");
    expect(lib.likeSentence(L(["Candy", "Mom"]))).toBe("Candy and Mom liked this");
    expect(lib.likeSentence(L(["Candy", "Mom", "Dad"], 4))).toBe("Candy, Mom, Dad + 4 others liked this");
    expect(lib.likeSentence(L(["Candy"], 0, true))).toBe("You and Candy liked this");
  });
});

describe("OpinionsSection", () => {
  it("renders nothing when switched off", async () => {
    vi.mocked(lib.getTitleOpinions).mockResolvedValue(title({ enabled: false }));
    const { container } = render(<OpinionsSection mediaType="movie" tmdbId={1} />);
    await waitFor(() => expect(lib.getTitleOpinions).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("shows opinions, who liked the title, and anonymous ones as Someone", async () => {
    vi.mocked(lib.getTitleOpinions).mockResolvedValue(
      title({
        likes: { count: 2, you_liked: false, people: [person("Candy")], more: 1 },
        opinions: [op(), op({ id: "o2", body: "secret", author: null, is_anonymous: true })],
      })
    );
    render(<OpinionsSection mediaType="movie" tmdbId={1} />);
    expect(await screen.findByText("Amazing, watch it!")).toBeInTheDocument();
    expect(screen.getByText("Someone")).toBeInTheDocument();
    expect(screen.getByText("Candy + 1 other liked this")).toBeInTheDocument();
  });

  it("posts an opinion, anonymously when asked, then reloads", async () => {
    vi.mocked(lib.getTitleOpinions).mockResolvedValue(title());
    vi.mocked(lib.postOpinion).mockResolvedValue(op());
    render(<OpinionsSection mediaType="tv" tmdbId={7} seasonNumber={1} episodeNumber={2} />);
    fireEvent.change(await screen.findByLabelText("Share what you thought…"), { target: { value: "Great episode" } });
    fireEvent.click(screen.getByLabelText("Post anonymously"));
    fireEvent.click(screen.getByRole("button", { name: "Post" }));
    await waitFor(() =>
      expect(lib.postOpinion).toHaveBeenCalledWith(
        { media_type: "tv", tmdb_id: 7, season_number: 1, episode_number: 2 }, "Great episode", true
      )
    );
    await waitFor(() => expect(lib.getTitleOpinions).toHaveBeenCalledTimes(2));
  });

  it("hearts the title and a comment", async () => {
    vi.mocked(lib.getTitleOpinions).mockResolvedValue(title({ opinions: [op()] }));
    vi.mocked(lib.likeTitle).mockResolvedValue({ count: 1, you_liked: true, people: [], more: 0 });
    vi.mocked(lib.likeOpinion).mockResolvedValue({ likes: 1, liked_by_me: true });
    render(<OpinionsSection mediaType="movie" tmdbId={1} />);
    await screen.findByText("Amazing, watch it!");
    fireEvent.click(screen.getByRole("button", { name: "Like this" }));
    await waitFor(() => expect(lib.likeTitle).toHaveBeenCalledWith(expect.objectContaining({ tmdb_id: 1 }), true));
    fireEvent.click(screen.getByRole("button", { name: "Like" }));
    await waitFor(() => expect(lib.likeOpinion).toHaveBeenCalledWith("o1", true));
    expect(await screen.findByRole("button", { name: "Unlike" })).toHaveAttribute("aria-pressed", "true");
  });

  it("replies appear under their opinion and a reply can be written", async () => {
    vi.mocked(lib.getTitleOpinions).mockResolvedValue(title({ opinions: [op({ replies: [op({ id: "r1", body: "Agreed", author: person("Dad") })] })] }));
    vi.mocked(lib.postOpinion).mockResolvedValue(op());
    render(<OpinionsSection mediaType="movie" tmdbId={1} />);
    expect(await screen.findByText("Agreed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    fireEvent.change(screen.getByLabelText("Reply to Mom"), { target: { value: "Same" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Post" })[1]);
    await waitFor(() => expect(lib.postOpinion).toHaveBeenCalledWith(expect.anything(), "Same", false, "o1"));
  });

  it("no composer when muted, and the reason is shown; replies hidden when switched off", async () => {
    vi.mocked(lib.getTitleOpinions).mockResolvedValue(title({ can_comment: false, why_not: "An admin has switched off commenting for you.", allow_replies: false, opinions: [op()] }));
    render(<OpinionsSection mediaType="movie" tmdbId={1} />);
    expect(await screen.findByText(/switched off commenting/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Share what you thought…")).toBeNull();
    expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
  });

  it("only own opinions (or any, for admins) can be deleted", async () => {
    vi.mocked(lib.getTitleOpinions).mockResolvedValue(title({ opinions: [op()] }));
    const { unmount } = render(<OpinionsSection mediaType="movie" tmdbId={1} />);
    await screen.findByText("Amazing, watch it!");
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    unmount();
    vi.mocked(lib.getTitleOpinions).mockResolvedValue(title({ moderator: true, opinions: [op({ author: null, is_anonymous: true, real_author: "Mom" })] }));
    vi.mocked(lib.deleteOpinion).mockResolvedValue();
    render(<OpinionsSection mediaType="movie" tmdbId={1} />);
    expect(await screen.findByText("is Mom")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(lib.deleteOpinion).toHaveBeenCalledWith("o1"));
  });
});

describe("OpinionsStrip", () => {
  const feedOp = (id: string, body: string): lib.FeedOpinion => ({
    id, body, created_at: new Date().toISOString(), author: person("Mom"), media_type: "movie", tmdb_id: 1,
    season_number: -1, episode_number: -1, title: "Spirited Away", poster_path: null, backdrop_path: null, likes: 3,
  });

  it("shows one quote and like chips", async () => {
    vi.mocked(lib.getFeed).mockResolvedValue({
      enabled: true, opinions: [feedOp("a", "So lovely"), feedOp("b", "Cried")],
      likes: [{ media_type: "movie", tmdb_id: 1, season_number: -1, episode_number: -1, title: "Spirited Away", poster_path: null, people: [person("Candy")], more: 0 }],
    });
    render(<OpinionsStrip />);
    expect(await screen.findByText(/So lovely/)).toBeInTheDocument();
    expect(screen.queryByText(/Cried/)).toBeNull();
    expect(screen.getByText("Candy liked Spirited Away")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Opinion 2" }));
    expect(await screen.findByText(/Cried/)).toBeInTheDocument();
  });

  it("renders nothing when off or empty", async () => {
    vi.mocked(lib.getFeed).mockResolvedValue({ enabled: false, opinions: [], likes: [] });
    const { container } = render(<OpinionsStrip />);
    await waitFor(() => expect(lib.getFeed).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

describe("Community settings", () => {
  it("saves each switch and dims the others when everything is off", async () => {
    const initial = settingsLib.DEFAULT_SETTINGS;
    vi.mocked(settingsLib.patchSettings).mockImplementation(async (p) => settingsLib.applyPatch(initial, p, initial));
    render(
      <SettingsProvider initial={initial}>
        <CommunitySettingsForm />
      </SettingsProvider>
    );
    fireEvent.click(screen.getByRole("switch", { name: "Let others see what I liked" }));
    await waitFor(() => expect(settingsLib.patchSettings).toHaveBeenCalledWith({ social: { share_likes: false } }));
    fireEvent.click(screen.getByRole("switch", { name: "Post anonymously by default" }));
    await waitFor(() => expect(settingsLib.patchSettings).toHaveBeenCalledWith({ social: { anonymous_by_default: true } }));
    fireEvent.click(screen.getByRole("switch", { name: "Show opinions and likes" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Let others see what I liked" })).toBeDisabled());
  });
});
