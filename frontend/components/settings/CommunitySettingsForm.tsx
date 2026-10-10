"use client";

import { useSettings } from "@/components/SettingsProvider";
import { SettingRow, SettingsCard, Toggle } from "@/components/settings/controls";

export default function CommunitySettingsForm() {
  const { settings, update } = useSettings();
  const s = settings.social;
  return (
    <SettingsCard title="Community" description="Opinions and hearts shared between everyone on CandyFlix.">
      <SettingRow
        label="Show opinions and likes"
        htmlFor="social-enabled"
        description="Off: you won't see anyone's opinions or hearts, and you can't post. Your own are hidden from others too."
      >
        <Toggle id="social-enabled" label="Show opinions and likes" checked={s.enabled} onChange={(enabled) => update({ social: { enabled } })} />
      </SettingRow>
      <SettingRow
        label="“From the family” on Home"
        htmlFor="social-home"
        description="The calm card with what others thought, shown under the banner on Home."
      >
        <Toggle id="social-home" label="From the family on Home" checked={s.show_on_home} disabled={!s.enabled} onChange={(show_on_home) => update({ social: { show_on_home } })} />
      </SettingRow>
      <SettingRow
        label="Let others see what I liked"
        htmlFor="social-share"
        description="Off: you can still heart things, but nobody sees or counts them, and you won't appear as “Candy liked this”."
      >
        <Toggle id="social-share" label="Let others see what I liked" checked={s.share_likes} disabled={!s.enabled} onChange={(share_likes) => update({ social: { share_likes } })} />
      </SettingRow>
      <SettingRow
        label="Post anonymously by default"
        htmlFor="social-anon"
        description="New opinions start as “Someone”. You can change it on each one. Admins can still see who wrote them."
      >
        <Toggle id="social-anon" label="Post anonymously by default" checked={s.anonymous_by_default} disabled={!s.enabled} onChange={(anonymous_by_default) => update({ social: { anonymous_by_default } })} />
      </SettingRow>
    </SettingsCard>
  );
}
