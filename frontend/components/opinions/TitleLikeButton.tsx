"use client";

import { useState } from "react";
import { useTitleLikes } from "@/lib/title-likes";
import type { Scope } from "@/lib/opinions";

export function HeartIcon({ filled, className = "" }: { filled: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    >
      <path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 5 6.4 5c2 0 3.7 1.1 5.6 3.2C13.9 6.1 15.6 5 17.6 5 21 5 23.1 8.4 21.6 11.8 19.5 16.4 12 21 12 21z" />
    </svg>
  );
}

/**
 * The heart. `variant="action"` matches the Watch Now / Add to box buttons (tall, rounded square);
 * `variant="pill"` is the smaller one beside an episode title in the player.
 * Renders nothing while loading and when opinions are switched off.
 */
export default function TitleLikeButton({
  scope,
  variant = "action",
  className = "",
  labelClass = "",
}: {
  scope: Scope;
  variant?: "action" | "pill";
  className?: string;
  /** Extra classes for the visible "Like" text (the detail page hides it once the buttons sit in a row). */
  labelClass?: string;
}) {
  const { enabled, likes, toggle } = useTitleLikes(scope);
  const [pop, setPop] = useState(0);
  if (!enabled) return null;
  const liked = likes.you_liked;
  const base =
    variant === "action"
      ? "flex h-12 items-center justify-center gap-2 whitespace-nowrap rounded-xl border font-semibold transition-colors"
      : "inline-flex h-9 items-center justify-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors";
  const tone = liked
    ? "border-accent bg-accent/10 text-accent hover:bg-accent/20"
    : "border-white/15 text-white/80 hover:border-white/30 hover:text-white";
  return (
    <button
      type="button"
      aria-pressed={liked}
      aria-label={liked ? "Unlike" : "Like"}
      onClick={() => {
        if (!liked) setPop((n) => n + 1);
        void toggle();
      }}
      className={`${base} ${tone} ${className}`}
    >
      <HeartIcon key={pop} filled={liked} className={`h-[1.2em] w-[1.2em] shrink-0 ${pop > 0 && liked ? "animate-heart-pop" : ""}`} />
      <span className={labelClass}>{liked ? "Liked" : "Like"}</span>
      {likes.count > 0 && <span className="tabular-nums">{likes.count}</span>}
    </button>
  );
}
