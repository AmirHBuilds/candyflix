"use client";

import Avatar from "@/components/Avatar";
import { HeartIcon } from "@/components/opinions/TitleLikeButton";
import { likeSentence, whereLabel, type FeedTitle } from "@/lib/opinions";

/**
 * Under the banner's title: who liked it, and the newest thing someone said about it, drifting in each time the
 * slide changes (`key` = the slide). Draws nothing for a title nobody has touched.
 */
export default function HeroSocial({ social }: { social: FeedTitle | undefined }) {
  if (!social) return null;
  const liked = social.likes.count > 0 ? likeSentence({ ...social.likes, you_liked: false }).replace(/ liked this$/, " liked it") : null;
  const latest = social.latest;
  if (!liked && !latest) return null;
  const who = latest?.author?.name ?? "Someone";
  const where = latest ? whereLabel(latest) : null;
  return (
    <div className="mb-4 flex max-w-xl flex-col items-start gap-2">
      {liked && (
        <p className="animate-drift-in flex items-center gap-2 rounded-full bg-black/35 py-1 pl-1.5 pr-3 text-sm text-white/85 backdrop-blur">
          <span className="flex -space-x-1.5">
            {social.likes.people.map((p) => (
              <Avatar key={p.id} name={p.name} src={p.avatar_url} size={22} className="ring-2 ring-black/40" />
            ))}
          </span>
          <HeartIcon filled className="h-3.5 w-3.5 shrink-0 text-accent" />
          <span>{liked}</span>
        </p>
      )}
      {latest && (
        <p
          className="animate-drift-in rounded-2xl rounded-bl-md bg-black/35 px-3.5 py-2 text-sm text-white/90 backdrop-blur"
          style={{ animationDelay: "0.25s" }}
        >
          <span className="line-clamp-2 break-words italic">“{latest.body}”</span>
          <span className="mt-0.5 block text-xs text-white/55">
            {who}
            {where ? ` · ${where}` : ""}
            {social.comment_count > 1 ? ` · +${social.comment_count - 1} more` : ""}
          </span>
        </p>
      )}
    </div>
  );
}
