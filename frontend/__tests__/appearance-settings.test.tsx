import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

import AppearanceSettingsForm from "@/components/settings/AppearanceSettingsForm";
import { SettingsProvider } from "@/components/SettingsProvider";
import * as lib from "@/lib/settings";

vi.mock("@/lib/settings", async () => {
  const actual = await vi.importActual<typeof lib>("@/lib/settings");
  return { ...actual, getSettings: vi.fn(), patchSettings: vi.fn(), resetSettings: vi.fn() };
});

const { DEFAULT_SETTINGS } = lib;

function renderForm(appearance: Partial<lib.Settings["appearance"]> = {}) {
  const initial = { ...DEFAULT_SETTINGS, appearance: { ...DEFAULT_SETTINGS.appearance, ...appearance } };
  vi.mocked(lib.patchSettings).mockImplementation(async (patch) => lib.applyPatch(initial, patch, DEFAULT_SETTINGS));
  return render(
    <SettingsProvider initial={initial}>
      <AppearanceSettingsForm />
    </SettingsProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-text-size");
  document.documentElement.removeAttribute("data-motion");
});

describe("Appearance settings", () => {
  it("lists every theme and marks the current one", () => {
    renderForm();
    const radios = screen.getAllByRole("radio", { name: /Candy at Night|Midnight|Mint|Lilac|Sunset|Mono/ });
    expect(radios).toHaveLength(6);
    expect(screen.getByRole("radio", { name: /Candy at Night/ })).toBeChecked();
  });

  it("choosing a theme saves it and switches the page at once", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("radio", { name: /Midnight/ }));
    expect(screen.getByRole("radio", { name: /Midnight/ })).toBeChecked();
    expect(document.documentElement.getAttribute("data-theme")).toBe("midnight");
    await waitFor(() => expect(lib.patchSettings).toHaveBeenCalledWith({ appearance: { theme: "midnight" } }));
  });

  it("text size and reduce motion are written to the page too", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("radio", { name: "Large" }));
    fireEvent.click(within_group("Reduce motion", "On"));
    expect(document.documentElement.getAttribute("data-text-size")).toBe("large");
    expect(document.documentElement.getAttribute("data-motion")).toBe("on");
    await waitFor(() => expect(lib.patchSettings).toHaveBeenCalledTimes(2));
  });

  it("changes home layout, titles per section and episode style", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("radio", { name: "Swipe rows" }));
    fireEvent.click(screen.getByRole("radio", { name: "36" }));
    fireEvent.click(screen.getByRole("radio", { name: "Compact blocks" }));
    await waitFor(() => expect(lib.patchSettings).toHaveBeenCalledTimes(3));
    expect(lib.patchSettings).toHaveBeenCalledWith({ appearance: { home_layout: "rows" } });
    expect(lib.patchSettings).toHaveBeenCalledWith({ appearance: { items_per_section: 36 } });
    expect(lib.patchSettings).toHaveBeenCalledWith({ appearance: { episode_view: "blocks" } });
  });

  it("changes the description length", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("radio", { name: "Full" }));
    await waitFor(() => expect(lib.patchSettings).toHaveBeenCalledWith({ appearance: { description_length: "full" } }));
  });

  it("banner rotation only appears while the banner is on", () => {
    const { unmount } = renderForm();
    expect(screen.getByRole("radiogroup", { name: "Banner rotation" })).toBeInTheDocument();
    unmount();
    renderForm({ hero_enabled: false });
    expect(screen.queryByRole("radiogroup", { name: "Banner rotation" })).toBeNull();
  });

  it("the toggles switch the banner, ratings and years", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("switch", { name: "Banner" }));
    fireEvent.click(screen.getByRole("switch", { name: "Show ratings" }));
    fireEvent.click(screen.getByRole("switch", { name: "Show years" }));
    await waitFor(() => expect(lib.patchSettings).toHaveBeenCalledTimes(3));
    expect(lib.patchSettings).toHaveBeenCalledWith({ appearance: { hero_enabled: false } });
    expect(lib.patchSettings).toHaveBeenCalledWith({ appearance: { show_ratings: false } });
    expect(lib.patchSettings).toHaveBeenCalledWith({ appearance: { show_years: false } });
  });
});

function within_group(groupName: string, optionName: string): HTMLElement {
  const group = screen.getByRole("radiogroup", { name: groupName });
  return Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]')).find((el) => el.textContent === optionName)!;
}
