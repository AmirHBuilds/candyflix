"use client";

import { useCallback, useEffect, useState } from "react";
import Flag from "@/components/player/Flag";
import { SettingRow, SettingsCard } from "@/components/settings/controls";
import { SUBTITLE_LANGUAGES } from "@/lib/languages";
import {
  clearAllSubtitleOverrides,
  clearSubtitleOverride,
  listSubtitleOverrides,
  type SubtitleOverride,
} from "@/lib/playback";
import { showToast } from "@/lib/toast";

function describeSettings(settings: SubtitleOverride["settings"]): string {
  const parts: string[] = [];
  const lang = settings.subtitle_language;
  if (typeof lang === "string") {
    parts.push(lang === "off" ? "captions off" : SUBTITLE_LANGUAGES.find((l) => l.code === lang)?.label ?? lang);
  }
  const offset = settings.subtitle_offset;
  if (typeof offset === "number") parts.push(`timing ${offset > 0 ? "+" : ""}${offset} s`);
  return parts.join(" · ");
}

function whereLabel(o: SubtitleOverride): string {
  return o.media_type === "tv" ? `Season ${o.season_number} · Episode ${o.episode_number}` : "Movie";
}

export default function SubtitleOverridesCard() {
  const [items, setItems] = useState<SubtitleOverride[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);

  const load = useCallback(() => {
    listSubtitleOverrides()
      .then((list) => {
        setItems(list);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load your saved subtitle settings."));
  }, []);
  useEffect(load, [load]);

  async function removeOne(o: SubtitleOverride) {
    try {
      await clearSubtitleOverride({
        mediaType: o.media_type,
        tmdbId: o.tmdb_id,
        seasonNumber: o.season_number,
        episodeNumber: o.episode_number,
      });
      setItems((cur) => cur?.filter((x) => x !== o) ?? cur);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't reset that video.");
    }
  }

  async function removeAll() {
    try {
      const n = await clearAllSubtitleOverrides();
      setItems([]);
      showToast(`Reset subtitles on ${n} video${n === 1 ? "" : "s"}.`, "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't reset them.");
    } finally {
      setArmed(false);
    }
  }

  return (
    <SettingsCard
      title="Videos with their own subtitle language or timing"
      description="The language or timing you set inside the player for one movie or episode. Reset one to forget them for that video."
    >
      {error ? (
        <p role="alert" className="px-5 py-4 text-sm text-red-300">
          {error}
        </p>
      ) : items === null ? (
        <p className="px-5 py-4 text-sm text-white/50">Loading…</p>
      ) : items.length === 0 ? (
        <p className="px-5 py-4 text-sm text-white/50">None yet. Every video follows your defaults.</p>
      ) : (
        <>
          <ul>
            {items.map((o) => (
              <li
                key={`${o.media_type}-${o.tmdb_id}-${o.season_number}-${o.episode_number}`}
                className="flex items-center justify-between gap-4 border-t border-white/10 px-5 py-3 first:border-t-0"
              >
                {typeof o.settings.subtitle_language === "string" && o.settings.subtitle_language !== "off" && (
                  <Flag language={o.settings.subtitle_language} />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">{o.title ?? `Title #${o.tmdb_id}`}</p>
                  <p className="truncate text-xs text-white/50">
                    {whereLabel(o)} — {describeSettings(o.settings)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeOne(o)}
                  aria-label={`Reset ${o.title ?? `title ${o.tmdb_id}`} ${whereLabel(o)}`}
                  className="h-9 shrink-0 rounded-lg bg-white/10 px-3 text-sm text-white/80 hover:bg-white/15"
                >
                  Reset
                </button>
              </li>
            ))}
          </ul>
          <SettingRow label="Reset all" description={`${items.length} video${items.length === 1 ? "" : "s"}. Volume and mute settings stay.`}>
            {armed ? (
              <div className="flex gap-2">
                <button type="button" onClick={removeAll} className="h-10 rounded-xl bg-red-500/90 px-4 text-sm font-semibold text-white hover:opacity-90">
                  Yes, reset all
                </button>
                <button type="button" onClick={() => setArmed(false)} className="h-10 rounded-xl bg-white/10 px-4 text-sm font-medium text-white/80 hover:bg-white/15">
                  Cancel
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setArmed(true)} className="h-10 rounded-xl bg-white/10 px-4 text-sm font-medium text-white/80 hover:bg-white/15">
                Reset all
              </button>
            )}
          </SettingRow>
        </>
      )}
    </SettingsCard>
  );
}
