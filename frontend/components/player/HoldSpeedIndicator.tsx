"use client";

import { HOLD_BASE_RATE, HOLD_MAX_RATE, HOLD_MIN_RATE, formatHoldRate, holdRateToGauge } from "@/components/player/hold-speed";

// Top-centre badge shown only while a hold is active: the live speed and
// a small gauge (0.5× · 2× · 4×) so it's obvious that sliding left/right
// changes it. Purely visual — never intercepts the hold gesture itself.
export default function HoldSpeedIndicator({ rate }: { rate: number }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute left-1/2 top-4 z-20 flex -translate-x-1/2 flex-col items-center gap-2 rounded-2xl bg-black/70 px-4 py-2.5 text-white shadow-lg ring-1 ring-white/10"
    >
      <span className="flex items-center gap-1.5 text-base font-semibold tabular-nums">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M4 5v14l9-7zM13 5v14l9-7z" />
        </svg>
        {formatHoldRate(rate)}
      </span>
      <div className="w-40" aria-hidden="true">
        <div className="relative h-1 rounded-full bg-white/25">
          <div
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#FF5FA2]"
            style={{ left: `${holdRateToGauge(rate) * 100}%` }}
          />
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] font-medium text-white/50">
          <span>{formatHoldRate(HOLD_MIN_RATE)}</span>
          <span>{formatHoldRate(HOLD_BASE_RATE)}</span>
          <span>{formatHoldRate(HOLD_MAX_RATE)}</span>
        </div>
      </div>
    </div>
  );
}
