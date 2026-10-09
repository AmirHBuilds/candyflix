import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RichAnswer from "@/components/RichAnswer";
import WatchAssistantPanel from "@/components/player/WatchAssistantPanel";
import { CONTROLS } from "@/components/player/controls";
import { assistantAvailable } from "@/lib/use-watch-ai";
import * as wa from "@/lib/watch-ai";
import { DEFAULT_SETTINGS } from "@/lib/settings";

vi.mock("@/lib/watch-ai", async (orig) => ({ ...(await orig<typeof import("@/lib/watch-ai")>()), askWatchAI: vi.fn() }));

afterEach(cleanup);

describe("RichAnswer", () => {
  it("blurs ||spoilers|| until tapped, and shows bold and bullets", async () => {
    render(<RichAnswer text={"**Anna** came home late.\n- Safe point\n- ||Secret point||\nAnd ||the twist|| is later."} />);
    expect(screen.getByText("Anna")).toBeInTheDocument();
    expect(screen.getByText("Safe point")).toBeInTheDocument();
    const hidden = document.querySelectorAll('[data-spoiler="hidden"]');
    expect(hidden).toHaveLength(2);
    // the real words are in the DOM but not announced, and the bars never show
    expect(document.body.textContent).not.toContain("||");
    await userEvent.setup().click(screen.getAllByRole("button", { name: /Spoiler/ })[0]);
    expect(document.querySelectorAll('[data-spoiler="hidden"]')).toHaveLength(1);
    expect(screen.getByText("Secret point")).toBeInTheDocument();
  });

  it("an unclosed spoiler hides everything after it, even across lines", () => {
    render(<RichAnswer text={"Fine so far. ||She dies\nand then everything changes"} />);
    expect(document.querySelectorAll('[data-spoiler="hidden"]').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Fine so far\./)).toBeInTheDocument();
  });

  it("never turns text into HTML", () => {
    const { container } = render(<RichAnswer text={"<img src=x onerror=alert(1)> **ok**"} />);
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("clock", () => {
  it("formats positions", () => {
    expect([0, 65, 754, 3723].map(wa.clock)).toEqual(["0:00", "1:05", "12:34", "1:02:03"]);
  });
});

describe("availability and settings", () => {
  it("needs a server with AI and a person who isn't switched off", () => {
    expect(assistantAvailable(null)).toBe(false);
    expect(assistantAvailable({ enabled: false, limit: 20, used: 0, remaining: 20 })).toBe(false);
    expect(assistantAvailable({ enabled: true, limit: 0, used: 0, remaining: 0 })).toBe(false);
    expect(assistantAvailable({ enabled: true, limit: 20, used: 3, remaining: 17 })).toBe(true);
    expect(assistantAvailable({ enabled: true, limit: null, used: 3, remaining: null })).toBe(true);
  });
  it("is a player button that is on by default", () => {
    expect(DEFAULT_SETTINGS.playback.controls.assistant).toBe(true);
    expect(CONTROLS.find((c) => c.id === "assistant")?.extra).toBeFalsy();
  });
});

describe("WatchAssistantPanel", () => {
  let position = 754;
  const mount = (over: Partial<React.ComponentProps<typeof WatchAssistantPanel>> = {}) =>
    render(
      <WatchAssistantPanel
        open
        onClose={() => {}}
        title="Night Owls S1:E2"
        mediaType="tv"
        tmdbId={99}
        seasonNumber={1}
        episodeNumber={2}
        getPosition={() => position}
        remaining={20}
        {...over}
      />,
    );

  beforeEach(() => {
    position = 754;
    vi.mocked(wa.askWatchAI).mockReset().mockResolvedValue({ answer: "Anna came home. ||She leaves later.||", has_dialogue: true, remaining: 19, limit: 20 });
  });

  it("offers the recap of the whole episode first, plus the other quick actions", () => {
    mount();
    const buttons = screen.getAllByRole("button").map((b) => b.textContent);
    expect(buttons).toEqual(expect.arrayContaining(["Recap of the whole episode", "Recap so far", "What just happened?", "Previously…"]));
    expect(screen.getAllByRole("button").filter((b) => /Recap|just happened|Previously/.test(b.textContent ?? ""))[0]).toHaveTextContent("Recap of the whole episode");
  });

  it("says movie, and has no 'Previously' for a movie", () => {
    mount({ mediaType: "movie", seasonNumber: null, episodeNumber: null, title: "Her" });
    expect(screen.getByText("Recap of the whole movie")).toBeInTheDocument();
    expect(screen.queryByText("Previously…")).toBeNull();
  });

  it("sends the question with where the video is, the intent and the title", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByText("Recap of the whole episode"));
    await waitFor(() => expect(wa.askWatchAI).toHaveBeenCalledTimes(1));
    expect(vi.mocked(wa.askWatchAI).mock.calls[0][0]).toMatchObject({
      media_type: "tv", tmdb_id: 99, season_number: 1, episode_number: 2, position_seconds: 754, intent: "recap_all", history: [],
    });
    expect(await screen.findByText(/Anna came home/)).toBeInTheDocument();
    expect(screen.getByText(/· video 12:34/)).toBeInTheDocument();
    expect(document.querySelectorAll('[data-spoiler="hidden"]')).toHaveLength(1);
    expect(screen.getByText("19 questions left today")).toBeInTheDocument();
  });

  it("a typed question later in the video carries its own time and the conversation so far", async () => {
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText("Your question"), "Who is Anna?{Enter}");
    await screen.findByText(/Anna came home/);
    position = 1500;
    await user.type(screen.getByLabelText("Your question"), "And why did she leave?{Enter}");
    await waitFor(() => expect(wa.askWatchAI).toHaveBeenCalledTimes(2));
    const second = vi.mocked(wa.askWatchAI).mock.calls[1][0];
    expect(second.position_seconds).toBe(1500);
    expect(second.intent).toBe("ask");
    expect(second.history).toEqual([
      { role: "user", text: "Who is Anna?", position_seconds: 754 },
      { role: "assistant", text: "Anna came home. ||She leaves later.||" },
    ]);
    expect(screen.getByText(/· video 25:00/)).toBeInTheDocument();
  });

  it("shows an error with a way to try again, and doesn't keep the failed question", async () => {
    vi.mocked(wa.askWatchAI).mockRejectedValueOnce(new Error("The AI is busy right now. Please try again in a moment."));
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByText("Recap so far"));
    expect(await screen.findByRole("alert")).toHaveTextContent("The AI is busy");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/Anna came home/)).toBeInTheDocument();
    expect(wa.askWatchAI).toHaveBeenCalledTimes(2);
  });

  it("stops offering questions when today's are used up", () => {
    mount({ remaining: 0 });
    expect(screen.queryByLabelText("Your question")).toBeNull();
    expect(screen.getByText(/used today's questions/)).toBeInTheDocument();
    for (const b of screen.getAllByRole("button").filter((b) => /Recap|just happened/.test(b.textContent ?? ""))) expect(b).toBeDisabled();
  });

  it("closes with the button and with Escape, and is hidden from everything while closed", () => {
    const onClose = vi.fn();
    const { rerender } = mount({ onClose });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
    rerender(
      <WatchAssistantPanel open={false} onClose={onClose} title="x" mediaType="movie" tmdbId={1} getPosition={() => 0} remaining={5} />,
    );
    expect(screen.getByLabelText("Ask about this", { selector: "aside" })).toHaveAttribute("aria-hidden", "true");
    expect(within(document.body).queryByRole("button", { name: "Close" })).toBeNull();
  });
});
