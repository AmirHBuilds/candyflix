export const SETTINGS_SECTIONS = [
  { id: "appearance", label: "Appearance" },
  { id: "playback", label: "Playback" },
  { id: "subtitles", label: "Subtitles" },
  { id: "account", label: "Account" },
  { id: "community", label: "Community" },
  { id: "privacy", label: "Privacy & data" },
  { id: "about", label: "About" },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];
