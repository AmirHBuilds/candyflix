"use client";

import RatingIcon from "@/components/RatingIcon";
import { RATING_SOURCES } from "@/lib/rating-sources";
import { useSettings } from "@/components/SettingsProvider";
import { SegmentedControl, SettingRow, SettingsCard, Toggle } from "@/components/settings/controls";
import type { Settings } from "@/lib/settings";
import { THEMES } from "@/lib/themes";

type Appearance = Settings["appearance"];

const ITEM_OPTIONS = [12, 18, 24, 36, 48].map((n) => ({ value: n, label: String(n) }));
const HERO_SECONDS = [5, 7, 10, 15].map((n) => ({ value: n, label: `${n}s` }));

export default function AppearanceSettingsForm() {
  const { settings, update } = useSettings();
  const a = settings.appearance;
  const set = (patch: Partial<Appearance>) => update({ appearance: patch });

  return (
    <>
      <SettingsCard title="Theme" description="Changes instantly, and follows you to every device.">
        <div role="radiogroup" aria-label="Theme" className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-3">
          {THEMES.map((theme) => {
            const selected = theme.id === a.theme;
            const c = theme.colors;
            return (
              <button
                key={theme.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => !selected && set({ theme: theme.id })}
                className={`flex flex-col gap-2.5 rounded-2xl border p-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  selected ? "border-accent bg-white/[0.06]" : "border-white/10 hover:bg-white/5"
                }`}
              >
                {/* A tiny mock of the app in this theme's colours. */}
                <span aria-hidden="true" className="flex h-16 flex-col justify-between rounded-lg p-2" style={{ backgroundColor: c.canvas }}>
                  <span className="flex gap-1">
                    <span className="h-1.5 w-8 rounded-full" style={{ backgroundColor: c.accent }} />
                    <span className="h-1.5 w-5 rounded-full bg-white/25" />
                  </span>
                  <span className="flex items-end gap-1.5">
                    <span className="h-7 w-5 rounded" style={{ backgroundColor: c.surface }} />
                    <span className="h-7 w-5 rounded" style={{ backgroundColor: c.surface }} />
                    <span className="ml-auto flex gap-1">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.secondary }} />
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.highlight }} />
                    </span>
                  </span>
                </span>
                <span className="flex items-center justify-between text-sm font-medium text-white">
                  {theme.label}
                  {selected && <span className="text-xs text-accent">Selected</span>}
                </span>
              </button>
            );
          })}
        </div>
      </SettingsCard>

      <SettingsCard title="Home screen" description="How the home page is laid out.">
        <SettingRow label="Layout" description="Grid wraps titles into rows and columns. Swipe rows gives each section one scrollable row.">
          <SegmentedControl
            label="Home layout"
            value={a.home_layout}
            options={[
              { value: "grid", label: "Grid" },
              { value: "rows", label: "Swipe rows" },
            ]}
            onChange={(home_layout) => set({ home_layout })}
          />
        </SettingRow>
        <SettingRow label="Titles per section" description="How many titles each home section shows.">
          <SegmentedControl label="Titles per section" value={a.items_per_section} options={ITEM_OPTIONS} onChange={(items_per_section) => set({ items_per_section })} />
        </SettingRow>
        <SettingRow label="Banner" htmlFor="hero-enabled" description="The big rotating title at the top of the home page.">
          <Toggle id="hero-enabled" label="Banner" checked={a.hero_enabled} onChange={(hero_enabled) => set({ hero_enabled })} />
        </SettingRow>
        {a.hero_enabled && (
          <SettingRow label="Banner description" htmlFor="hero-description" description="Show the short description under the banner title.">
            <Toggle id="hero-description" label="Banner description" checked={a.hero_description} onChange={(hero_description) => set({ hero_description })} />
          </SettingRow>
        )}
        {a.hero_enabled && (
          <SettingRow label="Banner rotation" description="How long each title stays before the next one.">
            <SegmentedControl label="Banner rotation" value={a.hero_interval_seconds} options={HERO_SECONDS} onChange={(hero_interval_seconds) => set({ hero_interval_seconds })} />
          </SettingRow>
        )}
        <SettingRow label="Show ratings" htmlFor="show-ratings" description="The ★ score under each poster.">
          <Toggle id="show-ratings" label="Show ratings" checked={a.show_ratings} onChange={(show_ratings) => set({ show_ratings })} />
        </SettingRow>
        <SettingRow label="Show years" htmlFor="show-years" description="The release year under each poster.">
          <Toggle id="show-years" label="Show years" checked={a.show_years} onChange={(show_years) => set({ show_years })} />
        </SettingRow>
      </SettingsCard>

      <SettingsCard title="Ratings on a title's page" description="Which scores appear next to a movie or show when you open it. (They are not shown on the posters.)">
        {RATING_SOURCES.map((r) => (
          <SettingRow key={r.id} label={r.label} htmlFor={`rating-${r.id}`} description={r.description}>
            <div className="flex items-center gap-3">
              <RatingIcon source={r.id} size={22} />
              <Toggle
                id={`rating-${r.id}`}
                label={`Show ${r.label}`}
                checked={a.rating_sources[r.id]}
                onChange={(v) => update({ appearance: { rating_sources: { [r.id]: v } } })}
              />
            </div>
          </SettingRow>
        ))}
      </SettingsCard>

      <SettingsCard title="Shows and descriptions">
        <SettingRow label="Episode list" description="Rows show a thumbnail and summary. Compact blocks show just the number and name, so more fit on screen.">
          <SegmentedControl
            label="Episode list style"
            value={a.episode_view}
            options={[
              { value: "list", label: "Rows" },
              { value: "blocks", label: "Compact blocks" },
            ]}
            onChange={(episode_view) => set({ episode_view })}
          />
        </SettingRow>
        <SettingRow label="Description length" description="How much of a synopsis to show on the banner, detail pages and episodes.">
          <SegmentedControl
            label="Description length"
            value={a.description_length}
            options={[
              { value: "short", label: "Short" },
              { value: "standard", label: "Standard" },
              { value: "full", label: "Full" },
            ]}
            onChange={(description_length) => set({ description_length })}
          />
        </SettingRow>
      </SettingsCard>

      <SettingsCard title="Comfort">
        <SettingRow label="Text size" description="Scales the whole interface.">
          <SegmentedControl
            label="Text size"
            value={a.text_size}
            options={[
              { value: "small", label: "Small" },
              { value: "default", label: "Default" },
              { value: "large", label: "Large" },
            ]}
            onChange={(text_size) => set({ text_size })}
          />
        </SettingRow>
        <SettingRow label="Reduce motion" description="Auto follows your device's setting. On calms animations; Off keeps them even if your device asks to reduce them.">
          <SegmentedControl
            label="Reduce motion"
            value={a.reduce_motion}
            options={[
              { value: "auto", label: "Auto" },
              { value: "on", label: "On" },
              { value: "off", label: "Off" },
            ]}
            onChange={(reduce_motion) => set({ reduce_motion })}
          />
        </SettingRow>
      </SettingsCard>
    </>
  );
}
