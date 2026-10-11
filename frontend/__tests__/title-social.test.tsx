import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import DiscussionButton from "@/components/opinions/DiscussionButton";
import HeroSocial from "@/components/opinions/HeroSocial";
import LikedByLine from "@/components/opinions/LikedByLine";
import TitleLikeButton from "@/components/opinions/TitleLikeButton";
import { EXPAND_TTL_MS, rememberExpanded, wasExpanded } from "@/lib/episode-expand";
import * as lib from "@/lib/opinions";

vi.mock("@/lib/opinions", async () => {
  const actual = await vi.importActual<typeof lib>("@/lib/opinions");
  return { ...actual, getTitleOpinions: vi.fn(), likeTitle: vi.fn() };
});

const person = (name: string) => ({ id: name, name, avatar_url: null });
const data = (over: Partial<lib.TitleOpinions> = {}): lib.TitleOpinions => ({
  enabled: true, moderator: false, can_comment: true, why_not: null, allow_anonymous: true, allow_replies: true, anonymous_default: false,
  likes: { count: 1, you_liked: false, people: [person("Candy")], more: 0 }, comment_count: 7, opinions: [], ...over,
});
let n = 100;
const scope = () => ({ media_type: "movie" as const, tmdb_id: ++n }); // a fresh title per test: the likes are shared per title

beforeEach(() => vi.clearAllMocks());

describe("heart, liked-by line and discussion", () => {
  it("the heart and the line stay in step, and one request serves both", async () => {
    const s = scope();
    vi.mocked(lib.getTitleOpinions).mockResolvedValue(data());
    vi.mocked(lib.likeTitle).mockResolvedValue({ count: 2, you_liked: true, people: [person("Candy")], more: 0 });
    render(
      <>
        <TitleLikeButton scope={s} />
        <LikedByLine scope={s} />
      </>
    );
    expect(await screen.findByText("Candy liked this")).toBeInTheDocument();
    expect(lib.getTitleOpinions).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Like" }));
    await waitFor(() => expect(lib.likeTitle).toHaveBeenCalledWith(expect.objectContaining({ tmdb_id: s.tmdb_id }), true));
    expect(await screen.findByText("You and Candy liked this")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unlike" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows nothing when opinions are switched off", async () => {
    const s = scope();
    vi.mocked(lib.getTitleOpinions).mockResolvedValue(data({ enabled: false }));
    const { container } = render(
      <>
        <TitleLikeButton scope={s} />
        <LikedByLine scope={s} />
        <DiscussionButton scope={s} title="X" />
      </>
    );
    await waitFor(() => expect(lib.getTitleOpinions).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("opens the discussion in a panel, and closes it again with Escape", async () => {
    const s = scope();
    vi.mocked(lib.getTitleOpinions).mockResolvedValue(data());
    render(<DiscussionButton scope={s} title="Spirited Away" />);
    fireEvent.click(await screen.findByRole("button", { name: "Discussion, 7 comments" }));
    const panel = await screen.findByRole("dialog", { name: "Discussion: Spirited Away" });
    expect(panel).toBeInTheDocument();
    expect(await screen.findByLabelText("Share what you thought…")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("counts and the banner", () => {
  it("the heart and the discussion icon show their counts, Instagram style", async () => {
    const s = scope();
    vi.mocked(lib.getTitleOpinions).mockResolvedValue(data({ likes: { count: 24, you_liked: false, people: [], more: 0 }, comment_count: 5 }));
    render(
      <>
        <TitleLikeButton scope={s} />
        <DiscussionButton scope={s} title="X" variant="action" />
      </>
    );
    expect(await screen.findByText("24")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discussion, 5 comments" })).toHaveTextContent("5");
  });

  it("the home banner shows who liked the title and the newest comment, and nothing for an untouched one", () => {
    const t: lib.FeedTitle = {
      media_type: "movie", tmdb_id: 1, title: "", poster_path: null, backdrop_path: null, comment_count: 3,
      latest: { id: "a", body: "Watch it!", created_at: new Date().toISOString(), author: person("Mom"), season_number: -1, episode_number: -1 },
      likes: { count: 25, you_liked: false, people: [person("Amir")], more: 24 },
    };
    const { container, rerender } = render(<HeroSocial social={t} />);
    expect(screen.getByText("Amir + 24 others liked it")).toBeInTheDocument();
    expect(screen.getByText(/Watch it!/)).toBeInTheDocument();
    expect(screen.getByText(/Mom · \+2 more/)).toBeInTheDocument();
    rerender(<HeroSocial social={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("remembering 'show all episodes'", () => {
  beforeEach(() => window.localStorage.clear());
  it("is remembered per show for 24 hours", () => {
    expect(wasExpanded(1)).toBe(false);
    rememberExpanded(1, 1000);
    expect(wasExpanded(1, 1000 + EXPAND_TTL_MS - 1)).toBe(true);
    expect(wasExpanded(2, 1000)).toBe(false);
    expect(wasExpanded(1, 1000 + EXPAND_TTL_MS + 1)).toBe(false);
    expect(wasExpanded(1, 1000)).toBe(false); // an expired entry is dropped
  });
});
