"use client";

import { getStaticOrigin } from "@/lib/api-client";
import type { BadgeContent } from "@/lib/site";

/** The built-in crown: shown until an admin uploads their own picture. */
function Crown() {
  return (
    <svg viewBox="0 0 64 50" width="100%" height="100%" aria-hidden="true">
      <defs>
        <linearGradient id="crownGold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFE9A0" />
          <stop offset="1" stopColor="#F2A900" />
        </linearGradient>
      </defs>
      <path d="M6 40 2 12l16 14L32 4l14 22 16-14-4 28z" fill="url(#crownGold)" stroke="#B87800" strokeWidth="1.5" strokeLinejoin="round" />
      <rect x="6" y="40" width="52" height="7" rx="2.5" fill="url(#crownGold)" stroke="#B87800" strokeWidth="1.5" />
      <circle cx="2" cy="11" r="3.2" className="fill-accent" />
      <circle cx="32" cy="3.6" r="3.6" className="fill-secondary" />
      <circle cx="62" cy="11" r="3.2" className="fill-highlight" />
      <circle cx="19" cy="43.5" r="1.8" className="fill-accent" />
      <circle cx="32" cy="43.5" r="1.8" className="fill-secondary" />
      <circle cx="45" cy="43.5" r="1.8" className="fill-highlight" />
    </svg>
  );
}

// Where the badge's base rests on the picture (as a share of its box), and how far it leans.
// The top-left/right spots are the points of the circle at 45 degrees, so the crown sits on the rim.
const SPOTS = {
  top: { left: "50%", top: "6%", rotate: 0 },
  "top-left": { left: "17%", top: "17%", rotate: -40 },
  "top-right": { left: "83%", top: "17%", rotate: 40 },
} as const;

/**
 * Draw this inside a `relative` box the size of the profile picture. `size` is the picture's width in px.
 * Decorative (the person's name and role are in the label next to it).
 */
export default function AdminBadge({ badge, size }: { badge: BadgeContent; size: number }) {
  const spot = SPOTS[badge.position] ?? SPOTS["top-left"];
  const width = Math.round(size * 0.5);
  return (
    <span
      aria-hidden="true"
      data-badge={badge.position}
      className="pointer-events-none absolute z-10 drop-shadow-[0_3px_6px_rgba(0,0,0,0.45)]"
      style={{
        left: spot.left,
        top: spot.top,
        width,
        height: Math.round(width * 0.78),
        transform: `translate(-50%, -100%) rotate(${spot.rotate}deg)`,
        transformOrigin: "50% 100%",
      }}
    >
      {badge.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element -- a small picture the admin uploaded, already resized by the backend
        <img src={`${getStaticOrigin()}${badge.image_url}`} alt="" className="h-full w-full object-contain" />
      ) : (
        <Crown />
      )}
    </span>
  );
}
