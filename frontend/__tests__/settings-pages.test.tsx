import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockPathname = { value: "/settings/appearance" };
const redirect = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname.value,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  redirect: (to: string) => redirect(to),
}));

import SettingsNav, { SETTINGS_SECTIONS } from "@/components/settings/SettingsNav";
import PlaybackSettingsForm from "@/components/settings/PlaybackSettingsForm";
import AboutSection from "@/components/settings/AboutSection";
import { SettingsProvider } from "@/components/SettingsProvider";
import SettingsIndex from "@/app/(main)/settings/page";
import PrivacySettings from "@/app/(main)/settings/privacy/page";
import SubtitleSettings from "@/app/(main)/settings/subtitles/page";
import PlaybackSettings from "@/app/(main)/settings/playback/page";
import * as lib from "@/lib/settings";

vi.mock("@/lib/settings", async () => {
  const actual = await vi.importActual<typeof lib>("@/lib/settings");
  return { ...actual, patchSettings: vi.fn(), resetSettings: vi.fn(), getSettings: vi.fn() };
});

const { DEFAULT_SETTINGS } = lib;

beforeEach(() => {
  vi.clearAllMocks();
  mockPathname.value = "/settings/appearance";
});

describe("SettingsNav", () => {
  it("lists every section as a link", () => {
    render(<SettingsNav />);
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual(SETTINGS_SECTIONS.map((s) => s.label));
    expect(SETTINGS_SECTIONS.map((s) => s.label)).toEqual([
      "Appearance",
      "Playback",
      "Subtitles",
      "Account",
      "Privacy & data",
      "About",
    ]);
  });

  it("marks only the current section as the current page", () => {
    mockPathname.value = "/settings/playback";
    render(<SettingsNav />);
    expect(screen.getByRole("link", { name: "Playback" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Appearance" })).not.toHaveAttribute("aria-current");
  });
});

describe("settings index", () => {
  it("opens on Appearance", () => {
    SettingsIndex();
    expect(redirect).toHaveBeenCalledWith("/settings/appearance");
  });
});

describe("placeholder sections say what's coming, and nothing pretends to work", () => {
  it.each([
    ["Subtitles", SubtitleSettings],
    ["Privacy & data", PrivacySettings],
  ])("%s", (title, Page) => {
    render(<Page />);
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getByText(/coming in an upcoming update/i)).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });
});

describe("Playback → Seek time (the first live setting)", () => {
  const renderForm = (initial = DEFAULT_SETTINGS) =>
    render(
      <SettingsProvider initial={initial}>
        <PlaybackSettingsForm />
      </SettingsProvider>
    );

  it("offers 5, 10, 15, 20 and 30 seconds with the saved value selected", () => {
    renderForm();
    expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual(["5s", "10s", "15s", "20s", "30s"]);
    expect(screen.getByRole("radio", { name: "10s" })).toHaveAttribute("aria-checked", "true");
  });

  it("reflects a non-default saved value", () => {
    renderForm({ ...DEFAULT_SETTINGS, playback: { ...DEFAULT_SETTINGS.playback, seek_seconds: 30 } });
    expect(screen.getByRole("radio", { name: "30s" })).toHaveAttribute("aria-checked", "true");
  });

  it("choosing a value saves exactly that change and shows it at once", async () => {
    vi.mocked(lib.patchSettings).mockResolvedValue({
      ...DEFAULT_SETTINGS,
      playback: { ...DEFAULT_SETTINGS.playback, seek_seconds: 20 },
    });
    renderForm();

    fireEvent.click(screen.getByRole("radio", { name: "20s" }));

    expect(screen.getByRole("radio", { name: "20s" })).toHaveAttribute("aria-checked", "true");
    await waitFor(() => expect(lib.patchSettings).toHaveBeenCalledWith({ playback: { seek_seconds: 20 } }));
  });

  it("the Playback page also lists what's still to come", () => {
    render(
      <SettingsProvider initial={DEFAULT_SETTINGS}>
        <PlaybackSettings />
      </SettingsProvider>
    );
    expect(screen.getByRole("radiogroup", { name: "Seek time" })).toBeInTheDocument();
    expect(screen.getByText(/Autoplay the next episode/)).toBeInTheDocument();
  });
});

describe("About → Reset all settings", () => {
  const renderAbout = () =>
    render(
      <SettingsProvider initial={DEFAULT_SETTINGS}>
        <AboutSection />
      </SettingsProvider>
    );

  it("credits TMDB", () => {
    renderAbout();
    expect(screen.getByText(/not endorsed or certified by TMDB/)).toBeInTheDocument();
  });

  it("needs a second confirming click, and Cancel backs out without resetting", () => {
    renderAbout();
    fireEvent.click(screen.getByRole("button", { name: "Reset…" }));
    expect(lib.resetSettings).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Reset…" })).toBeInTheDocument();
    expect(lib.resetSettings).not.toHaveBeenCalled();
  });

  it("confirming resets everything on the server and returns to the first button", async () => {
    vi.mocked(lib.resetSettings).mockResolvedValue(DEFAULT_SETTINGS);
    renderAbout();
    fireEvent.click(screen.getByRole("button", { name: "Reset…" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, reset" }));

    await waitFor(() => expect(lib.resetSettings).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("button", { name: "Reset…" })).toBeInTheDocument();
  });
});
