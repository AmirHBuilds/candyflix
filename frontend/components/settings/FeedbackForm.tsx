"use client";

import { useState } from "react";
import { SettingsCard } from "@/components/settings/controls";
import { FEEDBACK_KINDS, FEEDBACK_MAX, sendFeedback, type FeedbackKind } from "@/lib/feedback";
import { showToast } from "@/lib/toast";

/** A note to the admins. They see it in the admin panel (and get a Telegram message). */
export default function FeedbackForm() {
  const [kind, setKind] = useState<FeedbackKind>("idea");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await sendFeedback(kind, message.trim(), typeof window !== "undefined" ? window.location.pathname : undefined);
      setMessage("");
      setSent(true);
      showToast("Thank you! We got it.", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsCard title="Send us feedback" description="Something broken, something missing, something you love. We read every note.">
      <form onSubmit={submit} className="space-y-3 px-5 py-4">
        <div role="radiogroup" aria-label="What is it about?" className="flex flex-wrap gap-2">
          {FEEDBACK_KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              role="radio"
              aria-checked={kind === k.value}
              onClick={() => setKind(k.value)}
              className={`h-9 rounded-full px-4 text-sm transition-colors ${kind === k.value ? "bg-accent/20 text-accent" : "bg-white/10 text-white/70 hover:bg-white/15"}`}
            >
              {k.label}
            </button>
          ))}
        </div>
        <label htmlFor="feedback-message" className="sr-only">
          Your feedback
        </label>
        <textarea
          id="feedback-message"
          value={message}
          maxLength={FEEDBACK_MAX}
          rows={5}
          onChange={(e) => {
            setMessage(e.target.value);
            setSent(false);
          }}
          placeholder="Tell us what's on your mind…"
          className="w-full resize-y rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-accent focus:outline-none"
        />
        {error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-white/40">{sent ? "Sent. Thank you!" : `${message.length}/${FEEDBACK_MAX}`}</p>
          <button
            type="submit"
            disabled={busy || !message.trim()}
            className="h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
      </form>
    </SettingsCard>
  );
}
