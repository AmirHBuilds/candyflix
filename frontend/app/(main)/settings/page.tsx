import { redirect } from "next/navigation";
import AboutSection from "@/components/settings/AboutSection";
import AccountSettingsForm from "@/components/settings/AccountSettingsForm";
import AppearanceSettingsForm from "@/components/settings/AppearanceSettingsForm";
import PlaybackSettingsForm from "@/components/settings/PlaybackSettingsForm";
import PrivacyDataForm from "@/components/settings/PrivacyDataForm";
import SubtitleOverridesCard from "@/components/settings/SubtitleOverridesCard";
import SubtitleSettingsForm from "@/components/settings/SubtitleSettingsForm";
import SettingsBar from "@/components/settings/SettingsBar";
import SettingsSection from "@/components/settings/SettingsSection";
import { ComingSoon } from "@/components/settings/controls";
import { SETTINGS_SECTIONS } from "@/lib/settings-sections";
import { getServerCurrentUser } from "@/lib/session";

const label = (id: (typeof SETTINGS_SECTIONS)[number]["id"]) => SETTINGS_SECTIONS.find((s) => s.id === id)!.label;

export default async function SettingsPage() {
  const user = await getServerCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold text-white">Settings</h1>
      <SettingsBar />
      <div className="flex flex-col gap-10 pb-16">
        <SettingsSection id="appearance" title={label("appearance")}>
          <AppearanceSettingsForm />
        </SettingsSection>
        <SettingsSection id="playback" title={label("playback")}>
          <PlaybackSettingsForm />
          <ComingSoon title="More playback options" items={["Skip intro / auto-skip", "Customise the player's buttons"]} />
        </SettingsSection>
        <SettingsSection id="subtitles" title={label("subtitles")}>
          <SubtitleSettingsForm />
          <SubtitleOverridesCard />
        </SettingsSection>
        <SettingsSection id="account" title={label("account")}>
          <AccountSettingsForm user={user} />
        </SettingsSection>
        <SettingsSection id="privacy" title={label("privacy")}>
          <PrivacyDataForm />
        </SettingsSection>
        <SettingsSection id="about" title={label("about")}>
          <AboutSection />
        </SettingsSection>
      </div>
    </div>
  );
}
