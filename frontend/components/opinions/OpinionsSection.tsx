"use client";

import { useCallback, useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import HeartButton from "@/components/opinions/HeartButton";
import {
  deleteOpinion,
  getTitleOpinions,
  likeOpinion,
  likeSentence,
  likeTitle,
  postOpinion,
  timeAgo,
  type Opinion,
  type Scope,
  type TitleOpinions,
} from "@/lib/opinions";
import { showToast } from "@/lib/toast";

function Composer({
  placeholder,
  anonymousAllowed,
  anonymousDefault,
  onSend,
  onCancel,
  autoFocus,
}: {
  placeholder: string;
  anonymousAllowed: boolean;
  anonymousDefault: boolean;
  onSend: (body: string, anonymous: boolean) => Promise<void>;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState("");
  const [anon, setAnon] = useState(anonymousDefault);
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await onSend(text, anon);
      setText("");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't post that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        maxLength={500}
        rows={2}
        autoFocus={autoFocus}
        className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/35 focus:border-accent/60 focus:outline-none"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        {anonymousAllowed ? (
          <label className="flex cursor-pointer items-center gap-2 text-xs text-white/50">
            <input type="checkbox" checked={anon} onChange={(e) => setAnon(e.target.checked)} className="accent-accent" />
            Post anonymously
          </label>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/30">{text.length}/500</span>
          {onCancel && (
            <button type="button" onClick={onCancel} className="rounded-full px-3 py-1.5 text-xs text-white/60 hover:text-white">
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={send}
            disabled={!text.trim() || busy}
            className="rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-on-accent transition-opacity hover:bg-accent-hover disabled:opacity-40"
          >
            {busy ? "Posting…" : "Post"}
          </button>
        </div>
      </div>
    </div>
  );
}

function OpinionItem({
  o,
  data,
  isAdmin,
  onReply,
  onChanged,
  reply = false,
}: {
  o: Opinion;
  data: TitleOpinions;
  isAdmin: boolean;
  onReply?: (parentId: string, body: string, anon: boolean) => Promise<void>;
  onChanged: () => void;
  reply?: boolean;
}) {
  const [liked, setLiked] = useState(o.liked_by_me);
  const [likes, setLikes] = useState(o.likes);
  const [replying, setReplying] = useState(false);
  const name = o.author?.name ?? "Someone";

  async function toggle() {
    const next = !liked;
    setLiked(next);
    setLikes((n) => n + (next ? 1 : -1));
    try {
      const r = await likeOpinion(o.id, next);
      setLiked(r.liked_by_me);
      setLikes(r.likes);
    } catch (e) {
      setLiked(!next);
      setLikes((n) => n + (next ? -1 : 1));
      showToast(e instanceof Error ? e.message : "Couldn't save that.");
    }
  }

  async function remove() {
    try {
      await deleteOpinion(o.id);
      onChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't delete that.");
    }
  }

  return (
    <li className="animate-drift-in flex gap-3">
      {o.author ? <Avatar name={name} src={o.author.avatar_url} size={reply ? 24 : 32} /> : <Avatar name="?" size={reply ? 24 : 32} />}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-medium text-white">{o.mine ? "You" : name}</span>
          {o.is_anonymous && o.mine && <span className="text-xs text-white/40">(anonymous)</span>}
          {isAdmin && o.real_author && <span className="rounded-full bg-white/10 px-2 text-xs text-white/60">is {o.real_author}</span>}
          {isAdmin && o.hidden && <span className="rounded-full bg-white/10 px-2 text-xs text-white/60">hidden</span>}
          <span className="text-xs text-white/35">{timeAgo(o.created_at)}</span>
        </div>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-white/80">{o.body}</p>
        <div className="mt-1 flex items-center gap-1 text-xs">
          <HeartButton liked={liked} count={likes} onToggle={toggle} label={liked ? "Unlike" : "Like"} size={16} />
          {!reply && data.allow_replies && data.can_comment && (
            <button type="button" onClick={() => setReplying((v) => !v)} className="rounded-full px-2 py-1 text-white/50 hover:text-white/80">
              Reply
            </button>
          )}
          {(o.mine || isAdmin) && (
            <button type="button" onClick={remove} className="rounded-full px-2 py-1 text-white/40 hover:text-white/80">
              Delete
            </button>
          )}
        </div>
        {replying && onReply && (
          <div className="mt-2">
            <Composer
              autoFocus
              placeholder={`Reply to ${name}`}
              anonymousAllowed={data.allow_anonymous}
              anonymousDefault={data.anonymous_default}
              onCancel={() => setReplying(false)}
              onSend={async (b, a) => {
                await onReply(o.id, b, a);
                setReplying(false);
              }}
            />
          </div>
        )}
        {o.replies.length > 0 && (
          <ul className="mt-3 flex flex-col gap-3 border-l border-white/10 pl-4">
            {o.replies.map((r) => (
              <OpinionItem key={r.id} o={r} data={data} isAdmin={isAdmin} onChanged={onChanged} reply />
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

/** "What everyone thinks": hearts for the title and a calm list of opinions with replies. Hidden when switched off. */
export default function OpinionsSection({
  mediaType,
  tmdbId,
  seasonNumber,
  episodeNumber,
  heading = "What everyone thinks",
}: {
  mediaType: "movie" | "tv";
  tmdbId: number;
  seasonNumber?: number;
  episodeNumber?: number;
  heading?: string;
}) {
  const scope: Scope = { media_type: mediaType, tmdb_id: tmdbId, season_number: seasonNumber, episode_number: episodeNumber };
  const [data, setData] = useState<TitleOpinions | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await getTitleOpinions({ media_type: mediaType, tmdb_id: tmdbId, season_number: seasonNumber, episode_number: episodeNumber }));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [mediaType, tmdbId, seasonNumber, episodeNumber]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed || !data || !data.enabled) return null;

  const sentence = likeSentence(data.likes);

  async function toggleTitle() {
    if (!data) return;
    try {
      const likes = await likeTitle(scope, !data.likes.you_liked);
      setData({ ...data, likes });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't save that.");
    }
  }

  return (
    <section aria-labelledby="opinions-heading" className="animate-fade-up flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="opinions-heading" className="text-lg font-medium text-white/90">
          {heading}
        </h2>
        <div className="flex items-center gap-2">
          {data.likes.people.length > 0 && (
            <div className="flex -space-x-2">
              {data.likes.people.map((p) => (
                <Avatar key={p.id} name={p.name} src={p.avatar_url} size={22} className="ring-2 ring-canvas" />
              ))}
            </div>
          )}
          {sentence && <span className="text-sm text-white/55">{sentence}</span>}
          <HeartButton liked={data.likes.you_liked} onToggle={toggleTitle} label={data.likes.you_liked ? "Unlike this" : "Like this"} size={22} />
        </div>
      </div>

      {data.can_comment ? (
        <Composer
          placeholder="Share what you thought…"
          anonymousAllowed={data.allow_anonymous}
          anonymousDefault={data.anonymous_default}
          onSend={async (b, a) => {
            await postOpinion(scope, b, a);
            await load();
          }}
        />
      ) : (
        data.why_not && <p className="text-sm text-white/45">{data.why_not}</p>
      )}

      {data.opinions.length === 0 ? (
        <p className="text-sm text-white/40">No opinions yet. Be the first.</p>
      ) : (
        <ul className="flex flex-col gap-5">
          {data.opinions.map((o) => (
            <OpinionItem
              key={o.id}
              o={o}
              data={data}
              isAdmin={data.moderator}
              onChanged={load}
              onReply={async (parentId, b, a) => {
                await postOpinion(scope, b, a, parentId);
                await load();
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
