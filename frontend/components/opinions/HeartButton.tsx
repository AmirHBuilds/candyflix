"use client";

import { useState } from "react";

/** A small heart that pops when switched on. */
export default function HeartButton({
  liked,
  count,
  onToggle,
  label,
  size = 18,
}: {
  liked: boolean;
  count?: number;
  onToggle: () => void | Promise<void>;
  label: string;
  size?: number;
}) {
  const [pop, setPop] = useState(0);
  return (
    <button
      type="button"
      aria-pressed={liked}
      aria-label={label}
      onClick={() => {
        if (!liked) setPop((n) => n + 1);
        void onToggle();
      }}
      className={`group inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-sm transition-colors ${
        liked ? "text-accent" : "text-white/50 hover:text-white/80"
      }`}
    >
      <svg
        key={pop}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        aria-hidden="true"
        className={pop > 0 && liked ? "animate-heart-pop" : ""}
        fill={liked ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      >
        <path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 5 6.4 5c2 0 3.7 1.1 5.6 3.2C13.9 6.1 15.6 5 17.6 5 21 5 23.1 8.4 21.6 11.800 19.500 16.400 12 21 12 21z" />
      </svg>
      {count != null && count > 0 && <span>{count}</span>}
    </button>
  );
}
