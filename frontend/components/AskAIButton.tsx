"use client";

import { SparkleIcon } from "@/components/NavSearch";

/** The Ask AI call to action under a search: a real, filled button, so it reads as clickable. */
export default function AskAIButton({ query, onClick, hint }: { query: string; onClick: () => void; hint?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Ask AI about ${query}`}
      className="group flex w-full min-w-0 items-center gap-3 rounded-xl bg-accent px-4 py-3 text-left text-on-accent shadow-[0_6px_24px_-8px_color-mix(in_srgb,var(--color-accent)_70%,transparent)] transition-all hover:-translate-y-px hover:bg-accent-hover active:translate-y-0"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-on-accent/15">
        <SparkleIcon />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">Ask AI{hint ? `, ${hint}` : ""}</span>
        <span className="block truncate text-xs opacity-70">“{query}”</span>
      </span>
      <span aria-hidden className="text-lg transition-transform group-hover:translate-x-0.5">
        →
      </span>
    </button>
  );
}
