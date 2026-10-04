"use client";

import { useState } from "react";
import { getStaticOrigin } from "@/lib/api-client";

/**
 * A person's picture, or — with none (or if it fails to load) — a coloured
 * circle with their initial. One component so the header, the "Who's
 * watching?" picker and the account page all agree.
 */
export default function Avatar({
  name,
  src,
  size = 32,
  color,
  className = "",
}: {
  name: string;
  src?: string | null;
  size?: number;
  color?: string;
  className?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = !!src && failedSrc !== src;
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  const box = { width: size, height: size };

  if (showImage) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a small user upload, already resized by the backend
      <img
        src={`${getStaticOrigin()}${src}`}
        alt=""
        aria-hidden="true"
        style={box}
        onError={() => setFailedSrc(src)}
        className={`shrink-0 rounded-full bg-white/10 object-cover ${className}`}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{ ...box, fontSize: size * 0.4, ...(color ? { backgroundColor: color, color: "var(--color-on-accent)" } : {}) }}
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${
        color ? "" : "bg-accent/20 text-accent"
      } ${className}`}
    >
      {initial}
    </span>
  );
}
