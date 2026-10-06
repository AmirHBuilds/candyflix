import type { ReactNode } from "react";
import Flag from "@/components/player/Flag";

// One subtitle in a list: flag tile on the left, name and a small detail line,
// something on the right (a check when it's the one in use, or a button).
export default function SubtitleRow({
  language,
  title,
  detail,
  badges,
  active,
  busy,
  disabled,
  onClick,
  trailing,
}: {
  language: string;
  title: string;
  detail?: string | null;
  badges?: string[];
  active?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
  trailing?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-current={active ? "true" : undefined}
      className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors disabled:cursor-default ${
        active ? "bg-accent/15 ring-1 ring-inset ring-accent/50" : "bg-white/[0.04] enabled:hover:bg-white/[0.09]"
      }`}
    >
      <Flag language={language} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="text-sm font-medium text-white">{title}</span>
          {badges?.map((b) => (
            <span key={b} className="rounded bg-white/10 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-white/60">
              {b}
            </span>
          ))}
        </span>
        {detail && <span className="mt-0.5 line-clamp-2 break-all text-[11px] leading-snug text-white/45">{detail}</span>}
      </span>
      <span className="shrink-0 text-xs text-white/60">
        {busy ? "Adding…" : active ? <CheckIcon /> : trailing}
      </span>
    </button>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 text-accent" fill="none" stroke="currentColor" strokeWidth="2.5" aria-label="In use">
      <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
