import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockPathname = { value: "/settings/appearance" };
const redirect = vi.fn();
vi.mock("@/lib/session", () => ({ getServerCurrentUser: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname.value,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  redirect: (to: string) => redirect(to),
}));

import SettingsBar from "@/components/settings/SettingsBar";
import { SETTINGS_SECTIONS } from "@/lib/settings-sections";
import { getServerCurrentUser } from "@/lib/session";
import PlaybackSettingsForm from "@/components/settings/PlaybackSettingsForm";
import AboutSection from "@/components/settings/AboutSection";
import { SettingsProvider } from "@/components/SettingsProvider";
import SettingsPage from "@/app/(main)/settings/page";
import LegacyAppearance from "@/app/(main)/settings/appearance/page";
import LegacyPrivacy from "@/app/(main)/settings/privacy/page";
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

describe("SettingsBar", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("lists every section as a button, in order", () => {
    render(<SettingsBar />);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(SETTINGS_SECTIONS.map((s) => s.label));
    expect(SETTINGS_SECTIONS.map((s) => s.label)).toEqual(["Appearance", "Playback", "Subtitles", "Account", "Privacy & data", "About"]);
  });

  it("scrolls to the section and marks only it as current", () => {
    document.body.insertAdjacentHTML("beforeend", SETTINGS_SECTIONS.map((x) => `<section id="${x.id}"></section>`).join(""));
    render(<SettingsBar />);
    fireEvent.click(screen.getByRole("button", { name: "Playback" }));
    expect(document.getElementById("playback")!.scrollIntoView).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Playback" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "Appearance" })).not.toHaveAttribute("aria-current");
    SETTINGS_SECTIONS.forEach((x) => document.getElementById(x.id)?.remove());
  });
});

describe("the one long settings page", () => {
  const user = { id: "1", username: "candy", display_name: "Candy", created_at: "x" };

  it("renders every section as its own block, in order", async () => {
    vi.mocked(getServerCurrentUser).mockResolvedValue(user);
    render(
      <SettingsProvider initial={DEFAULT_SETTINGS}>{await SettingsPage()}</SettingsProvider>
    );
    const headings = SETTINGS_SECTIONS.map((x) => document.getElementById(`${x.id}-heading`)?.textContent);
    expect(headings).toEqual(SETTINGS_SECTIONS.map((x) => x.label));
    expect(screen.getByRole("radiogroup", { name: "Seek time" })).toBeInTheDocument();
    expect(screen.queryByText(/coming in an upcoming update/i)).toBeNull();
  });

  it("sends a signed-out visitor to login", async () => {
    vi.mocked(getServerCurrentUser).mockResolvedValue(null);
    await SettingsPage();
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("old per-section addresses jump to the section", () => {
    LegacyAppearance();
    expect(redirect).toHaveBeenCalledWith("/settings#appearance");
    LegacyPrivacy();
    expect(redirect).toHaveBeenCalledWith("/settings#privacy");
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

describe("Playback → Skipping", () => {
  const renderForm = () =>
    render(
      <SettingsProvider initial={DEFAULT_SETTINGS}>
        <PlaybackSettingsForm />
      </SettingsProvider>
    );

  it("shows the defaults: buttons on, auto-skip off", () => {
    renderForm();
    expect(screen.getByRole("switch", { name: "Skip intro automatically" })).toHaveAttribute("aria-checked", "false");
    for (const name of ["Skip Intro button", "Skip Recap button", "Skip Credits button"]) {
      expect(screen.getByRole("switch", { name })).toHaveAttribute("aria-checked", "true");
    }
  });

  it("each switch saves just its own key", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("switch", { name: "Skip intro automatically" }));
    fireEvent.click(screen.getByRole("switch", { name: "Skip Recap button" }));
    await waitFor(() => expect(lib.patchSettings).toHaveBeenCalledTimes(2));
    expect(lib.patchSettings).toHaveBeenCalledWith({ playback: { auto_skip_intro: true } });
    expect(lib.patchSettings).toHaveBeenCalledWith({ playback: { skip_buttons: { recap: false } } });
  });
});
