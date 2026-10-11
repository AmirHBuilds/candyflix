"use client";

import Avatar from "@/components/Avatar";
import { HeartIcon } from "@/components/opinions/TitleLikeButton";
import { likeSentence, whereLabel, type FeedTitle } from "@/lib/opinions";

function CommentIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
    </svg>
  );
}

/**
 * What the family did on a banner title. Two shapes of the same facts:
 * - big screens: a small frosted card in the banner's bottom-right corner (the newest comment with its author's picture,
 *   and who liked it underneath), drifting in whenever the slide changes;
 * - smaller screens: one quiet line under the title ("♥ Amir + 24 others · 💬 3").
 * Draws nothing for a title nobody has touched. Render it inside the slide (the card is positioned against the banner).
 */
export default function HeroSocial({ social }: { social: FeedTitle | undefined }) {
  if (!social) return null;
  const liked = social.likes.count > 0 ? likeSentence({ ...social.likes, you_liked: false }).replace(/ liked this$/, " liked it") : null;
  const latest = social.latest;
  if (!liked && !latest) return null;
  const who = latest?.author?.name ?? "Someone";
  const where = latest ? whereLabel(latest) : null;
  const more = social.comment_count - 1;

  return (
    <>
      {/* Small screens: one line. */}
      <p className="animate-drift-in mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/80 lg:hidden">
        {liked && (
          <span className="flex items-center gap-1.5">
            <HeartIcon filled className="h-3.5 w-3.5 text-accent" />
            {liked}
          </span>
        )}
        {social.comment_count > 0 && (
          <span className="flex items-center gap-1.5">
            <CommentIcon className="h-3.5 w-3.5" />
            {social.comment_count}
          </span>
        )}
      </p>

      {/* Large screens: the card. */}
      <aside
        aria-label="What your people said"
        className="animate-drift-in absolute bottom-16 right-12 hidden w-72 flex-col gap-3 rounded-2xl border border-white/10 bg-canvas/55 p-4 text-left shadow-2xl backdrop-blur-md lg:flex"
      >
        {latest && (
          <div className="flex gap-3">
            {latest.author ? <Avatar name={who} src={latest.author.avatar_url} size={32} /> : <span className="h-8 w-8 shrink-0 rounded-full bg-white/10" aria-hidden="true" />}
            <div className="min-w-0">
              <p className="line-clamp-3 break-words text-sm italic leading-snug text-white/90">“{latest.body}”</p>
              <p className="mt-1 truncate text-xs text-white/50">
                {who}
                {where ? ` · ${where}` : ""}
                {more > 0 ? ` · +${more} more` : ""}
              </p>
            </div>
          </div>
        )}
        {liked && (
          <p className={`flex items-center gap-2 text-xs text-white/70 ${latest ? "border-t border-white/10 pt-3" : ""}`}>
            <HeartIcon filled className="h-3.5 w-3.5 shrink-0 text-accent" />
            <span className="truncate">{liked}</span>
          </p>
        )}
      </aside>
    </>
  );
}
