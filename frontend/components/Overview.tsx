"use client";

import { useSettings } from "@/components/SettingsProvider";
import { overviewForLength } from "@/lib/media";

/** A synopsis, trimmed according to Settings → Appearance → Description length. */
export default function Overview({
  text,
  standardMax = 200,
  className = "",
}: {
  text: string;
  standardMax?: number;
  className?: string;
}) {
  const { settings } = useSettings();
  if (!text) return null;
  return <p className={className}>{overviewForLength(text, settings.appearance.description_length, standardMax)}</p>;
}
