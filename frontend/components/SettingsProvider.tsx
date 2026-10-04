"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { appearanceAttributes } from "@/lib/appearance";
import {
  DEFAULT_SETTINGS,
  applyPatch,
  getSettings,
  patchSettings,
  resetSettings,
  type Settings,
  type SettingsPatch,
} from "@/lib/settings";
import { showToast } from "@/lib/toast";

type SettingsContextValue = {
  settings: Settings;
  /** Changes some settings. Shows the change immediately, saves in the background. */
  update: (patch: SettingsPatch) => Promise<void>;
  /** Back to defaults, everywhere. */
  reset: () => Promise<void>;
};

// Outside a provider (the login page, isolated component tests) everything
// still works — with the defaults, and changes simply go nowhere.
const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  update: async () => {},
  reset: async () => {},
});

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}

/**
 * Holds the signed-in person's settings for the whole authenticated app.
 * The layouts load them on the server and pass them in as `initial`, so
 * the first paint already uses the right values (no flash of defaults).
 */
export function SettingsProvider({ initial, children }: { initial: Settings; children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(initial);
  // Numbers each save. Only the answer to the most recently *issued* save
  // is adopted, so a slow earlier response arriving late can't overwrite a
  // newer change (the newer save's own answer already reflects both).
  const latestSave = useRef(0);

  // The root layout wrote the <html> attributes for the first paint; this
  // keeps them current when a setting changes (theme switches instantly).
  const { theme, text_size, reduce_motion } = settings.appearance;
  useEffect(() => {
    const root = document.documentElement;
    const attrs = appearanceAttributes({ ...settings.appearance, theme, text_size, reduce_motion });
    for (const [name, value] of Object.entries(attrs)) root.setAttribute(name, value);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only these three matter
  }, [theme, text_size, reduce_motion]);

  const update = useCallback(async (patch: SettingsPatch) => {
    setSettings((current) => applyPatch(current, patch, DEFAULT_SETTINGS));
    const mine = ++latestSave.current;
    try {
      const saved = await patchSettings(patch);
      if (mine === latestSave.current) setSettings(saved);
    } catch {
      showToast("Couldn't save your settings. Please try again.");
      // Re-sync with whatever the server really has, so the screen
      // doesn't keep showing a change that didn't stick.
      try {
        if (mine === latestSave.current) setSettings(await getSettings());
      } catch {
        /* offline: keep the optimistic value; the next save will reconcile */
      }
    }
  }, []);

  const reset = useCallback(async () => {
    try {
      setSettings(await resetSettings());
    } catch {
      showToast("Couldn't reset your settings. Please try again.");
    }
  }, []);

  const value = useMemo(() => ({ settings, update, reset }), [settings, update, reset]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}
