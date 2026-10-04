import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/settings", async () => {
  const actual = await vi.importActual<typeof import("@/lib/settings")>("@/lib/settings");
  return { ...actual, patchSettings: vi.fn(), resetSettings: vi.fn(), getSettings: vi.fn() };
});
vi.mock("@/lib/playback", async () => {
  const actual = await vi.importActual<typeof import("@/lib/playback")>("@/lib/playback");
  return { ...actual, listSubtitleOverrides: vi.fn(), clearSubtitleOverride: vi.fn(), clearAllSubtitleOverrides: vi.fn() };
});
vi.mock("@/lib/toast", () => ({ showToast: vi.fn() }));

import SubtitleSettingsForm from "@/components/settings/SubtitleSettingsForm";
import SubtitleOverridesCard from "@/components/settings/SubtitleOverridesCard";
import { SettingsProvider } from "@/components/SettingsProvider";
import * as lib from "@/lib/settings";
import * as playback from "@/lib/playback";

const { DEFAULT_SETTINGS } = lib;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(lib.patchSettings).mockImplementation(async () => DEFAULT_SETTINGS);
});

const renderForm = () =>
  render(
    <SettingsProvider initial={DEFAULT_SETTINGS}>
      <SubtitleSettingsForm />
    </SettingsProvider>
  );

describe("Settings → Subtitles style", () => {
  it("shows a preview in the current style", () => {
    renderForm();
    const preview = screen.getByTestId("subtitle-preview");
    expect(preview).toHaveStyle({ fontSize: "22px", color: "rgb(255, 255, 255)" });
  });

  it("changing a colour saves that one key and updates the preview at once", async () => {
    renderForm();
    fireEvent.click(screen.getAllByLabelText("Use #FFE066")[0]);
    expect(screen.getByTestId("subtitle-preview")).toHaveStyle({ color: "rgb(255, 224, 102)" });
    await waitFor(() => expect(lib.patchSettings).toHaveBeenCalledWith({ subtitles: { color: "#FFE066" } }));
  });

  it("a slider previews while dragging and saves once, when released", async () => {
    renderForm();
    const size = screen.getByLabelText("Size");
    fireEvent.change(size, { target: { value: "30" } });
    fireEvent.change(size, { target: { value: "32" } });
    expect(lib.patchSettings).not.toHaveBeenCalled();
    fireEvent.pointerUp(size);
    await waitFor(() => expect(lib.patchSettings).toHaveBeenCalledTimes(1));
    expect(lib.patchSettings).toHaveBeenCalledWith({ subtitles: { font_size: 32 } });
  });

  it("toggles, position and alignment save their own key", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("switch", { name: "Shadow" }));
    fireEvent.click(screen.getByRole("radio", { name: "Top" }));
    fireEvent.click(screen.getByRole("radio", { name: "Right" }));
    await waitFor(() => expect(lib.patchSettings).toHaveBeenCalledTimes(3));
    expect(lib.patchSettings).toHaveBeenCalledWith({ subtitles: { shadow: false } });
    expect(lib.patchSettings).toHaveBeenCalledWith({ subtitles: { position: "top" } });
    expect(lib.patchSettings).toHaveBeenCalledWith({ subtitles: { align: "right" } });
  });

  it("reset needs a second click and sends null for every style key", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Reset style" }));
    expect(lib.patchSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yes, reset the style" }));
    await waitFor(() => expect(lib.patchSettings).toHaveBeenCalled());
    const sent = vi.mocked(lib.patchSettings).mock.calls[0][0] as { subtitles: Record<string, null> };
    expect(Object.keys(sent.subtitles).sort()).toEqual(Object.keys(DEFAULT_SETTINGS.subtitles).sort());
    expect(Object.values(sent.subtitles).every((v) => v === null)).toBe(true);
  });
});

const item = (over = {}) => ({
  media_type: "tv" as const,
  tmdb_id: 1396,
  season_number: 2,
  episode_number: 5,
  title: "Breaking Bad",
  settings: { subtitle_language: "fa", subtitle_offset: 1.5, subtitle_color: "#fff000", subtitle_shadow: false },
  updated_at: null,
  ...over,
});

describe("Settings → videos with their own subtitle settings", () => {
  it("lists each video with a plain summary", async () => {
    vi.mocked(playback.listSubtitleOverrides).mockResolvedValue([item(), item({ media_type: "movie", season_number: null, episode_number: null, tmdb_id: 603, title: null, settings: { subtitle_language: "off" } })]);
    render(<SubtitleOverridesCard />);
    expect(await screen.findByText("Breaking Bad")).toBeInTheDocument();
    expect(screen.getByText(/Season 2 · Episode 5 — Persian.*· timing \+1.5 s · 2 style changes/)).toBeInTheDocument();
    expect(screen.getByText("Title #603")).toBeInTheDocument();
    expect(screen.getByText(/Movie — captions off/)).toBeInTheDocument();
  });

  it("says so when there are none", async () => {
    vi.mocked(playback.listSubtitleOverrides).mockResolvedValue([]);
    render(<SubtitleOverridesCard />);
    expect(await screen.findByText(/None yet/)).toBeInTheDocument();
  });

  it("shows a load error", async () => {
    vi.mocked(playback.listSubtitleOverrides).mockRejectedValue(new Error("nope"));
    render(<SubtitleOverridesCard />);
    expect((await screen.findByRole("alert")).textContent).toBe("nope");
  });

  it("resets one video and removes it from the list", async () => {
    vi.mocked(playback.listSubtitleOverrides).mockResolvedValue([item()]);
    vi.mocked(playback.clearSubtitleOverride).mockResolvedValue();
    render(<SubtitleOverridesCard />);
    fireEvent.click(await screen.findByRole("button", { name: /Reset Breaking Bad/ }));
    await waitFor(() => expect(screen.getByText(/None yet/)).toBeInTheDocument());
    expect(playback.clearSubtitleOverride).toHaveBeenCalledWith({ mediaType: "tv", tmdbId: 1396, seasonNumber: 2, episodeNumber: 5 });
  });

  it("reset all needs a second click", async () => {
    vi.mocked(playback.listSubtitleOverrides).mockResolvedValue([item()]);
    vi.mocked(playback.clearAllSubtitleOverrides).mockResolvedValue(1);
    render(<SubtitleOverridesCard />);
    await screen.findByText("Breaking Bad");
    fireEvent.click(screen.getByRole("button", { name: "Reset all" }));
    expect(playback.clearAllSubtitleOverrides).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yes, reset all" }));
    await waitFor(() => expect(screen.getByText(/None yet/)).toBeInTheDocument());
  });
});
