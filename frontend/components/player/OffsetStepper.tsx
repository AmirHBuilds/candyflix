"use client";

import { useRef, useState } from "react";
import {
  OFFSET_STEP_MS,
  formatOffset,
  formatOffsetForEditing,
  parseOffsetInput,
  stepOffsetSeconds,
} from "@/components/player/subtitle-settings";

// `‹  -2.3 S  ›` — the two chevrons nudge the timing by 100 ms, and the
// number itself is click-to-edit for big jumps. No limits anywhere.
const stepButtonClass =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-white/80 transition hover:bg-[#FF5FA2]/20 hover:text-[#FF5FA2] active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FF5FA2]/70";
const valueClass =
  "font-[family-name:var(--font-display)] text-3xl font-semibold italic tabular-nums";

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <path d={direction === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function OffsetStepper({
  value,
  onChange,
}: {
  value: number; // seconds
  onChange: (seconds: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // Escape must discard the draft, but unmounting the focused input can
  // still fire a blur in some browsers — which would commit it. This
  // flag tells that blur to stand down.
  const skipBlurCommit = useRef(false);

  function startEditing() {
    skipBlurCommit.current = false;
    setDraft(formatOffsetForEditing(value));
    setEditing(true);
  }

  function commit() {
    const parsed = parseOffsetInput(draft);
    // Invalid input just reverts (nothing is changed).
    if (parsed !== null) onChange(parsed);
    setEditing(false);
  }

  const active = Math.round(value * 10) !== 0;
  const [number, unit] = formatOffset(value).split(" ");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] p-1.5">
        <button
          type="button"
          aria-label="Subtitles 100 milliseconds earlier"
          onClick={() => onChange(stepOffsetSeconds(value, -OFFSET_STEP_MS))}
          className={stepButtonClass}
        >
          <Chevron direction="left" />
        </button>

        {editing ? (
          <div className="flex min-w-0 flex-1 items-baseline justify-center gap-1.5 px-2">
            <input
              type="text"
              inputMode="decimal"
              aria-label="Timing offset in seconds"
              autoFocus
              value={draft}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                if (skipBlurCommit.current) return;
                commit();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  skipBlurCommit.current = true;
                  setEditing(false);
                }
              }}
              className={`${valueClass} w-full min-w-0 border-b-2 border-[#FF5FA2] bg-transparent text-center text-white outline-none`}
            />
            <span className="text-sm font-semibold tracking-widest text-white/40">S</span>
          </div>
        ) : (
          <button
            type="button"
            aria-label="Edit timing offset"
            title="Click to type an exact value"
            onClick={startEditing}
            className="flex min-w-0 flex-1 items-baseline justify-center gap-1.5 rounded-xl px-2 py-1.5 transition hover:bg-white/[0.05]"
          >
            <span className={`${valueClass} ${active ? "text-[#FF5FA2]" : "text-white"}`}>{number}</span>
            <span className="text-sm font-semibold tracking-widest text-white/40">{unit}</span>
          </button>
        )}

        <button
          type="button"
          aria-label="Subtitles 100 milliseconds later"
          onClick={() => onChange(stepOffsetSeconds(value, OFFSET_STEP_MS))}
          className={stepButtonClass}
        >
          <Chevron direction="right" />
        </button>
      </div>
      <p className="text-center text-[11px] text-white/30">
        Steps of 0.1 s · tap the number to type an exact value
      </p>
    </div>
  );
}
