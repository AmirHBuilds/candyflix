"use client";

import type { Cue } from "@/components/player/subtitle-utils";
import { findActiveCue } from "@/components/player/subtitle-utils";
import type { SubtitleSettings } from "@/components/player/subtitle-settings";

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const bigint = parseInt(clean, 16);
  if (Number.isNaN(bigint)) return `rgba(0, 0, 0, ${alpha})`;
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function SubtitleOverlay({
  cues,
  currentTime,
  settings,
}: {
  cues: Cue[];
  currentTime: number;
  settings: SubtitleSettings;
}) {
  const active = findActiveCue(cues, currentTime, settings.offsetSeconds);
  if (!active) return null;

  const justify =
    settings.align === "left" ? "justify-start" : settings.align === "right" ? "justify-end" : "justify-center";

  return (
    <div
      className={`pointer-events-none absolute inset-x-0 flex px-6 ${
        settings.position === "bottom" ? "bottom-20" : "top-20"
      } ${justify}`}
      aria-live="polite"
    >
      <span
        style={{
          fontFamily: settings.fontFamily,
          fontSize: settings.fontSize,
          fontWeight: settings.fontWeight,
          color: settings.color,
          backgroundColor: hexToRgba(settings.backgroundColor, settings.backgroundOpacity),
          padding: "0.25em 0.6em",
          borderRadius: 6,
          textShadow: settings.shadow ? "0 2px 8px rgba(0,0,0,0.85)" : undefined,
          WebkitTextStroke: settings.outline ? `1px ${settings.outlineColor}` : undefined,
          whiteSpace: "pre-line",
          textAlign: settings.align,
          maxWidth: "80%",
          lineHeight: 1.4,
        }}
      >
        {active.text}
      </span>
    </div>
  );
}
