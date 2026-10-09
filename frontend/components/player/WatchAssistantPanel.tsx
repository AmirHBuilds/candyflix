"use client";

import { useEffect, useRef, useState } from "react";
import RichAnswer from "@/components/RichAnswer";
import { AssistantIcon } from "@/components/player/icons";
import { askWatchAI, clock, type WatchIntent, type WatchTurn } from "@/lib/watch-ai";

type Message = { id: number; role: "user" | "assistant"; text: string; position?: number; pending?: boolean; error?: boolean; retry?: () => void };

type Quick = { intent: WatchIntent; label: string; question: string };

function quickActions(isMovie: boolean): Quick[] {
  const what = isMovie ? "movie" : "episode";
  return [
    { intent: "recap_all", label: `Recap of the whole ${what}`, question: `Give me a recap of the whole ${what}.` },
    { intent: "recap_so_far", label: "Recap so far", question: "Recap what has happened so far." },
    { intent: "just_happened", label: "What just happened?", question: "What just happened?" },
    ...(isMovie ? [] : [{ intent: "previously" as const, label: "Previously…", question: "What happened before this episode?" }]),
  ];
}

/**
 * The player's right-hand "Ask about this" panel. Each question goes to the server together with where the
 * video is right now; the server gives the AI the title's dialogue and details (never the video). Spoilers in
 * answers arrive wrapped in ||bars|| and show blurred until tapped (see RichAnswer). The conversation is kept
 * while the player is open, even if the panel is closed and reopened.
 */
export default function WatchAssistantPanel({
  open,
  onClose,
  title,
  mediaType,
  tmdbId,
  seasonNumber,
  episodeNumber,
  getPosition,
  remaining: remainingFromStatus,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  mediaType: "movie" | "tv";
  tmdbId: number;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  getPosition: () => number;
  remaining: number | null;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(remainingFromStatus);
  const nextId = useRef(1);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const isMovie = mediaType === "movie";
  const quick = quickActions(isMovie);
  const outOfQuestions = remaining !== null && remaining <= 0;

  useEffect(() => setRemaining(remainingFromStatus), [remainingFromStatus]);
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    if (typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    else el.scrollTop = el.scrollHeight;
  }, [messages]);
  useEffect(() => {
    if (open) input.current?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function send(question: string, intent: WatchIntent = "ask") {
    const q = question.trim();
    if (!q || busy || outOfQuestions) return;
    const position = getPosition();
    const history: WatchTurn[] = messages
      .filter((m) => !m.pending && !m.error)
      .slice(-8)
      .map((m) => ({ role: m.role, text: m.text, ...(m.role === "user" && m.position !== undefined ? { position_seconds: m.position } : {}) }));
    const userId = nextId.current++;
    const replyId = nextId.current++;
    setMessages((cur) => [...cur.filter((m) => !m.error), { id: userId, role: "user", text: q, position }, { id: replyId, role: "assistant", text: "", pending: true }]);
    setText("");
    setBusy(true);
    try {
      const r = await askWatchAI({
        media_type: mediaType,
        tmdb_id: tmdbId,
        season_number: seasonNumber ?? null,
        episode_number: episodeNumber ?? null,
        question: q,
        position_seconds: position,
        intent,
        history,
      });
      setMessages((cur) => cur.map((m) => (m.id === replyId ? { id: replyId, role: "assistant", text: r.answer } : m)));
      setRemaining(r.remaining);
    } catch (err) {
      const message = err instanceof Error ? err.message : "The assistant couldn't answer right now.";
      setMessages((cur) =>
        cur
          .filter((m) => m.id !== userId)
          .map((m) => (m.id === replyId ? { id: replyId, role: "assistant", text: message, error: true, retry: () => void send(q, intent) } : m)),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside
      aria-label="Ask about this"
      aria-hidden={!open}
      inert={!open}
      data-open={open}
      className={`absolute inset-y-0 right-0 z-30 flex w-full flex-col border-l border-white/10 bg-canvas/95 shadow-2xl backdrop-blur-xl transition-transform duration-200 sm:bottom-24 sm:w-[24rem] ${
        open ? "translate-x-0" : "invisible translate-x-full"
      }`}
    >
      <header className="flex items-start gap-3 border-b border-white/10 px-4 py-3">
        <span className="mt-0.5 text-accent">
          <AssistantIcon />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-white">Ask about this</h2>
          <p className="truncate text-xs text-white/50">{title}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      <div ref={list} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
        {messages.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-white/60">Lost the thread? Ask me anything about this {isMovie ? "movie" : "episode"}. I know where you are, so I won&apos;t give away what&apos;s coming.</p>
            <div className="flex flex-col gap-2">
              {quick.map((q, i) => (
                <button
                  key={q.intent}
                  type="button"
                  disabled={busy || outOfQuestions}
                  onClick={() => void send(q.question, q.intent)}
                  className={`rounded-xl px-4 py-2.5 text-left text-sm font-medium transition-colors disabled:opacity-40 ${i === 0 ? "bg-accent text-on-accent hover:bg-accent-hover" : "bg-white/10 text-white hover:bg-white/15"}`}
                >
                  {q.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-white/40">Anything hidden behind a blur is a spoiler. Tap it to reveal.</p>
          </div>
        ) : (
          messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="flex flex-col items-end gap-1">
                <p className="max-w-[85%] rounded-2xl rounded-br-md bg-white/15 px-3.5 py-2 text-sm text-white">{m.text}</p>
                {m.position !== undefined && <span className="text-[11px] text-white/35">at {clock(m.position)}</span>}
              </div>
            ) : (
              <div key={m.id} className="flex gap-2.5">
                <span className="mt-0.5 shrink-0 text-accent">
                  <AssistantIcon />
                </span>
                <div className="min-w-0 flex-1">
                  {m.pending ? (
                    <p className="text-sm text-white/50 motion-safe:animate-pulse">Thinking…</p>
                  ) : m.error ? (
                    <div className="space-y-2">
                      <p role="alert" className="text-sm text-red-300">{m.text}</p>
                      {m.retry && !outOfQuestions && (
                        <button type="button" onClick={m.retry} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/15">
                          Try again
                        </button>
                      )}
                    </div>
                  ) : (
                    <RichAnswer text={m.text} />
                  )}
                </div>
              </div>
            ),
          )
        )}
      </div>

      <footer className="space-y-2 border-t border-white/10 px-4 py-3">
        {messages.length > 0 && (
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {quick.map((q) => (
              <button
                key={q.intent}
                type="button"
                disabled={busy || outOfQuestions}
                onClick={() => void send(q.question, q.intent)}
                className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-xs text-white/85 hover:bg-white/15 disabled:opacity-40"
              >
                {q.label}
              </button>
            ))}
          </div>
        )}
        {outOfQuestions ? (
          <p className="text-xs text-white/50">You&apos;ve used today&apos;s questions. They come back tomorrow.</p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(text);
            }}
            className="flex items-end gap-2"
          >
            <textarea
              ref={input}
              rows={1}
              value={text}
              maxLength={400}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(text);
                }
              }}
              placeholder={`Ask about this ${isMovie ? "movie" : "episode"}…`}
              aria-label="Your question"
              className="max-h-24 min-h-10 flex-1 resize-none rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-accent/60"
            />
            <button
              type="submit"
              disabled={busy || text.trim().length === 0}
              aria-label="Send"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-on-accent transition-opacity hover:bg-accent-hover disabled:opacity-40"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
          </form>
        )}
        {remaining !== null && !outOfQuestions && <p className="text-[11px] text-white/35">{remaining} {remaining === 1 ? "question" : "questions"} left today</p>}
      </footer>
    </aside>
  );
}
