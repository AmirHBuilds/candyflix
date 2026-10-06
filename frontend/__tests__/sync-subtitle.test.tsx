import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SyncSubtitleControl from "@/components/player/SyncSubtitleControl";
import type { SyncStatus } from "@/lib/subtitle-sync";

vi.mock("@/lib/subtitle-sync", async (orig) => {
  const real = await orig<typeof import("@/lib/subtitle-sync")>();
  return { ...real, getSyncStatus: vi.fn(), startSync: vi.fn() };
});
import { getSyncStatus, startSync } from "@/lib/subtitle-sync";

const track = { language: "en", label: "English", url: "/subtitle-cache/x.srt", format: "srt" as const };
const identity = { mediaType: "tv" as const, tmdbId: 1, seasonNumber: 1, episodeNumber: 1 };
const st = (over: Partial<SyncStatus>): SyncStatus => ({
  state: "idle",
  percent: 0,
  stage: null,
  message: null,
  track: null,
  ...over,
});
const fill = () => screen.getByTestId("sync-fill").style.width;

beforeEach(() => {
  vi.mocked(getSyncStatus).mockReset();
  vi.mocked(startSync).mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("SyncSubtitleControl", () => {
  it("offers the button when nothing is running", async () => {
    vi.mocked(getSyncStatus).mockResolvedValue(st({ state: "idle" }));
    render(<SyncSubtitleControl track={track} identity={identity} onSynced={vi.fn()} />);
    expect((await screen.findByRole("button", { name: "Sync subtitle" }) as HTMLButtonElement).disabled).toBe(false);
    expect(fill()).toBe("0%");
  });

  it("fills the button and shows what is happening, following the server's progress", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(getSyncStatus).mockResolvedValue(st({ state: "idle" }));
    vi.mocked(startSync).mockResolvedValue(st({ state: "running", percent: 10, message: "Extracting audio and finding speech" }));
    render(<SyncSubtitleControl track={track} identity={identity} onSynced={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Sync subtitle" }));

    expect(await screen.findByText("Extracting audio and finding speech")).toBeTruthy();
    expect(fill()).toBe("10%");
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);

    vi.mocked(getSyncStatus).mockResolvedValue(st({ state: "running", percent: 74, message: "Looking for places where the delay changes" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    expect(await screen.findByText("Looking for places where the delay changes")).toBeTruthy();
    expect(fill()).toBe("74%");
  });

  it("picks the running job back up after a page refresh, without clicking", async () => {
    vi.mocked(getSyncStatus).mockResolvedValue(st({ state: "running", percent: 41, message: "Extracting audio and finding speech (38%)" }));
    render(<SyncSubtitleControl track={track} identity={identity} onSynced={vi.fn()} />);
    expect(await screen.findByText(/Extracting audio/)).toBeTruthy();
    expect(fill()).toBe("41%");
    expect(startSync).not.toHaveBeenCalled();
  });

  it("hands over the synced track when the job finishes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const synced = { ...track, url: "/subtitle-cache/sync-1.srt", synced: true };
    const onSynced = vi.fn();
    vi.mocked(getSyncStatus).mockResolvedValue(st({ state: "running", percent: 90, message: "Checking the result" }));
    render(<SyncSubtitleControl track={track} identity={identity} onSynced={onSynced} />);
    await screen.findByText("Checking the result");
    vi.mocked(getSyncStatus).mockResolvedValue(st({ state: "done", percent: 100, track: synced }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    await waitFor(() => expect(onSynced).toHaveBeenCalledWith(synced));
  });

  it("shows why it failed and lets you try again", async () => {
    vi.mocked(getSyncStatus).mockResolvedValue(st({ state: "failed", message: "Couldn't sync this one confidently, so it was left as it is." }));
    render(<SyncSubtitleControl track={track} identity={identity} onSynced={vi.fn()} />);
    expect(await screen.findByText(/left as it is/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Sync subtitle" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows an error when starting is refused", async () => {
    vi.mocked(getSyncStatus).mockResolvedValue(st({ state: "idle" }));
    vi.mocked(startSync).mockRejectedValue(new Error("Lots of syncs are running right now."));
    render(<SyncSubtitleControl track={track} identity={identity} onSynced={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Sync subtitle" }));
    expect(await screen.findByText(/Lots of syncs/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Sync subtitle" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
