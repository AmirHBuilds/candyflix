"use client";

import DiscussionButton from "@/components/opinions/DiscussionButton";
import TitleLikeButton from "@/components/opinions/TitleLikeButton";
import LikedByLine from "@/components/opinions/LikedByLine";
import type { Scope } from "@/lib/opinions";

/** The heart and discussion block beside a title (or episode) on the player page, with who liked it underneath. */
export default function PlayerSocial({ scope, title }: { scope: Scope; title: string }) {
  return (
    <div className="flex shrink-0 flex-col items-end gap-2 max-sm:w-full max-sm:items-stretch">
      {/* The same joined block as on the detail page: heart and discussion, icon and count only. */}
      <div className="flex h-11 divide-x divide-white/15 overflow-hidden rounded-xl border border-white/15 max-sm:w-full">
        <TitleLikeButton scope={scope} variant="segment" className="px-4 max-sm:flex-1" labelClass="sr-only" />
        <DiscussionButton scope={scope} title={title} variant="segment" className="max-sm:flex-1" />
      </div>
      <LikedByLine scope={scope} className="text-xs" />
    </div>
  );
}
