"use client";

import DiscussionButton from "@/components/opinions/DiscussionButton";
import TitleLikeButton from "@/components/opinions/TitleLikeButton";
import LikedByLine from "@/components/opinions/LikedByLine";
import type { Scope } from "@/lib/opinions";

/** The heart and Discussion button beside a title (or episode) on the player page, with who liked it underneath. */
export default function PlayerSocial({ scope, title }: { scope: Scope; title: string }) {
  return (
    <div className="flex shrink-0 flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <TitleLikeButton scope={scope} variant="pill" />
        <DiscussionButton scope={scope} title={title} />
      </div>
      <LikedByLine scope={scope} className="text-xs" />
    </div>
  );
}
