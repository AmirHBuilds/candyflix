"use client";

import Avatar from "@/components/Avatar";
import { likeSentence, type Scope } from "@/lib/opinions";
import { useTitleLikes } from "@/lib/title-likes";

/** "Candy and Mom liked this", with their little faces. Nothing when nobody has liked it. */
export default function LikedByLine({ scope, className = "" }: { scope: Scope; className?: string }) {
  const { enabled, likes } = useTitleLikes(scope);
  const text = likeSentence(likes);
  if (!enabled || !text) return null;
  return (
    <p className={`flex items-center gap-2 text-sm text-white/55 ${className}`}>
      {likes.people.length > 0 && (
        <span className="flex -space-x-1.5">
          {likes.people.map((p) => (
            <Avatar key={p.id} name={p.name} src={p.avatar_url} size={20} className="ring-2 ring-canvas" />
          ))}
        </span>
      )}
      <span>{text}</span>
    </p>
  );
}
