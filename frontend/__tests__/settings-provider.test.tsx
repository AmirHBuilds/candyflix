import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

import { SettingsProvider, useSettings } from "@/components/SettingsProvider";
import * as lib from "@/lib/settings";
import { clearAllToasts, getToasts } from "@/lib/toast";

vi.mock("@/lib/settings", async () => {
  const actual = await vi.importActual<typeof lib>("@/lib/settings");
  return { ...actual, getSettings: vi.fn(), patchSettings: vi.fn(), resetSettings: vi.fn() };
});

const { DEFAULT_SETTINGS } = lib;
const withTheme = (theme: lib.Theme): lib.Settings => ({
  ...DEFAULT_SETTINGS,
  appearance: { ...DEFAULT_SETTINGS.appearance, theme },
});

let api!: ReturnType<typeof useSettings>;
function Probe() {
  api = useSettings();
  return (
    <>
      <p data-testid="theme">{api.settings.appearance.theme}</p>
      <p data-testid="seek">{api.settings.playback.seek_seconds}</p>
    </>
  );
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearAllToasts();
});
afterEach(() => clearAllToasts());

describe("SettingsProvider", () => {
  it("starts from the settings the server rendered (no flash of defaults)", () => {
    render(
      <SettingsProvider initial={withTheme("mint")}>
        <Probe />
      </SettingsProvider>
    );
    expect(screen.getByTestId("theme")).toHaveTextContent("mint");
  });

  it("works without a provider, with the defaults and harmless setters", async () => {
    render(<Probe />);
    expect(screen.getByTestId("theme")).toHaveTextContent("candy-at-night");
    await act(async () => api.update({ appearance: { theme: "mint" } }));
    expect(screen.getByTestId("theme")).toHaveTextContent("candy-at-night");
  });

  it("shows a change instantly, before the server has answered", async () => {
    const d = deferred<lib.Settings>();
    vi.mocked(lib.patchSettings).mockReturnValue(d.promise);
    render(
      <SettingsProvider initial={DEFAULT_SETTINGS}>
        <Probe />
      </SettingsProvider>
    );

    let pending!: Promise<void>;
    act(() => {
      pending = api.update({ playback: { seek_seconds: 20 } });
    });

    expect(screen.getByTestId("seek")).toHaveTextContent("20"); // optimistic
    expect(lib.patchSettings).toHaveBeenCalledWith({ playback: { seek_seconds: 20 } });

    await act(async () => {
      d.resolve({ ...DEFAULT_SETTINGS, playback: { ...DEFAULT_SETTINGS.playback, seek_seconds: 20 } });
      await pending;
    });
    expect(screen.getByTestId("seek")).toHaveTextContent("20");
  });

  it("adopts the server's validated answer once saved", async () => {
    vi.mocked(lib.patchSettings).mockResolvedValue(withTheme("lilac"));
    render(
      <SettingsProvider initial={DEFAULT_SETTINGS}>
        <Probe />
      </SettingsProvider>
    );
    await act(async () => api.update({ appearance: { theme: "mint" } }));
    expect(screen.getByTestId("theme")).toHaveTextContent("lilac"); // what the server actually stored
  });

  it("a failed save toasts, then re-syncs with what the server really has", async () => {
    vi.mocked(lib.patchSettings).mockRejectedValue(new Error("down"));
    vi.mocked(lib.getSettings).mockResolvedValue(DEFAULT_SETTINGS);
    render(
      <SettingsProvider initial={DEFAULT_SETTINGS}>
        <Probe />
      </SettingsProvider>
    );

    await act(async () => api.update({ appearance: { theme: "mint" } }));

    await waitFor(() => expect(screen.getByTestId("theme")).toHaveTextContent("candy-at-night"));
    expect(getToasts().map((t) => t.message)).toEqual(["Couldn't save your settings. Please try again."]);
  });

  it("if even the re-sync fails (offline) it keeps the change on screen instead of crashing", async () => {
    vi.mocked(lib.patchSettings).mockRejectedValue(new Error("down"));
    vi.mocked(lib.getSettings).mockRejectedValue(new Error("down"));
    render(
      <SettingsProvider initial={DEFAULT_SETTINGS}>
        <Probe />
      </SettingsProvider>
    );
    await act(async () => api.update({ appearance: { theme: "mint" } }));
    expect(screen.getByTestId("theme")).toHaveTextContent("mint");
  });

  it("a slow earlier save can't overwrite a newer change", async () => {
    const first = deferred<lib.Settings>();
    const second = deferred<lib.Settings>();
    vi.mocked(lib.patchSettings).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(
      <SettingsProvider initial={DEFAULT_SETTINGS}>
        <Probe />
      </SettingsProvider>
    );

    let p1!: Promise<void>, p2!: Promise<void>;
    act(() => {
      p1 = api.update({ appearance: { theme: "mint" } });
      p2 = api.update({ appearance: { theme: "lilac" } });
    });
    expect(screen.getByTestId("theme")).toHaveTextContent("lilac");

    await act(async () => {
      second.resolve(withTheme("lilac"));
      await p2;
    });
    await act(async () => {
      first.resolve(withTheme("mint")); // arrives late with stale data
      await p1;
    });

    expect(screen.getByTestId("theme")).toHaveTextContent("lilac");
  });

  it("reset puts everything back to the defaults", async () => {
    vi.mocked(lib.resetSettings).mockResolvedValue(DEFAULT_SETTINGS);
    render(
      <SettingsProvider initial={withTheme("mint")}>
        <Probe />
      </SettingsProvider>
    );
    await act(async () => api.reset());
    expect(screen.getByTestId("theme")).toHaveTextContent("candy-at-night");
  });

  it("a failed reset toasts and leaves settings as they were", async () => {
    vi.mocked(lib.resetSettings).mockRejectedValue(new Error("down"));
    render(
      <SettingsProvider initial={withTheme("mint")}>
        <Probe />
      </SettingsProvider>
    );
    await act(async () => api.reset());
    expect(screen.getByTestId("theme")).toHaveTextContent("mint");
    expect(getToasts()[0].message).toMatch(/reset/i);
  });
});
