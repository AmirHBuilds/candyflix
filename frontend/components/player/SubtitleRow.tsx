import { useEffect, useRef, type ReactNode } from "react";
import Flag from "@/components/player/Flag";

// One subtitle in a list: flag tile on the left, name and a small detail line,
// something on the right (a check when it's the one in use, or a button).
export default function SubtitleRow({
  language,
  title,
  fullTitle,
  detail,
  active,
  busy,
  disabled,
  onClick,
  trailing,
}: {
  language: string;
  title: string;
  // The untouched name, shown on hover when `title` is a summary of it.
  fullTitle?: string;
  detail?: string | null;
  active?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
  trailing?: ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  // When the menu opens, bring the subtitle in use into view (inside the menu's own scroll area only).
  useEffect(() => {
    // Only when the list hasn't been scrolled yet: rows that appear later ("Show more") must not move the view.
    const area = ref.current?.closest<HTMLElement>("[data-scroll-area]");
    if (active && (!area || area.scrollTop === 0)) centerInScrollArea(ref.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={fullTitle}
      aria-current={active ? "true" : undefined}
      className={`flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors disabled:cursor-default ${
        active ? "bg-accent/15 ring-1 ring-inset ring-accent/50" : "enabled:hover:bg-white/[0.08]"
      }`}
    >
      <Flag language={language} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="min-w-0 text-sm font-medium text-white [overflow-wrap:anywhere]">{title}</span>
        </span>
        {detail && <span className="mt-0.5 line-clamp-2 text-[11px] [overflow-wrap:anywhere] leading-snug text-white/45">{detail}</span>}
      </span>
      <span className="ml-1 shrink-0 whitespace-nowrap text-xs text-white/60">
        {busy ? "Adding…" : active ? <CheckIcon /> : trailing}
      </span>
    </button>
  );
}

/** Scrolls the nearest `[data-scroll-area]` so `el` sits in the middle. Never scrolls the page. */
export function centerInScrollArea(el: HTMLElement | null) {
  const area = el?.closest<HTMLElement>("[data-scroll-area]");
  if (!el || !area) return;
  const a = area.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (a.height === 0) return; // hidden tab: nothing to scroll yet
  area.scrollTop += r.top - a.top - (a.height - r.height) / 2;
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 text-accent" fill="none" stroke="currentColor" strokeWidth="2.5" aria-label="In use">
      <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
