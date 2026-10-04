import PlaybackSettingsForm from "@/components/settings/PlaybackSettingsForm";
import { ComingSoon } from "@/components/settings/controls";

export default function PlaybackSettings() {
  return (
    <>
      <PlaybackSettingsForm />
      <ComingSoon
        title="More playback options"
        items={[
          "Autoplay the next episode",
          "Skip intro / auto-skip",
          "Customise the player's buttons",
          "Auto-select subtitles in your language",
          "Save watch progress, remember settings per video",
        ]}
      />
    </>
  );
}
