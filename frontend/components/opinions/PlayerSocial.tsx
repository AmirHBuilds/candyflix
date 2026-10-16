"use client";

import DiscussionButton from "@/components/opinions/DiscussionButton";
import TitleLikeButton from "@/components/opinions/TitleLikeButton";
import LikedByLine from "@/components/opinions/LikedByLine";
import type { Scope } from "@/lib/opinions";

/** The heart and discussion block beside a title (or episode) on the player page, with who liked it underneath. Icon-sized
 *  like on a big screen; only on a screen too narrow to sit beside the title does it take its own row, in two equal halves. */
export default function PlayerSocial({ scope, title }: { scope: Scope; title: string }) {
  return (
    <div className="flex shrink-0 flex-col items-end gap-2 max-[344px]:w-full max-[344px]:items-stretch">
      {/* The same joined block as on the detail page: heart and discussion, icon and count only. */}
      <div className="flex h-11 divide-x divide-white/15 overflow-hidden rounded-xl border border-white/15 max-[344px]:w-full">
        <TitleLikeButton scope={scope} variant="segment" className="px-4 max-[344px]:flex-1" labelClass="sr-only" />
        <DiscussionButton scope={scope} title={title} variant="segment" className="max-[344px]:flex-1" />
      </div>
      <LikedByLine scope={scope} className="text-xs" />
    </div>
  );
}
