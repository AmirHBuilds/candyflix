"use client";

import { useDesktopKeyboard } from "@/components/player/useDesktopKeyboard";

const ALIGN = {
  start: "left-0",
  center: "left-1/2 -translate-x-1/2",
  end: "right-0",
} as const;

/**
 * Hover label for a player control: its name, plus its keyboard
 * shortcut(s) on desktop-class devices only.
 *
 * Pure CSS visibility, so it costs no state: Tailwind's `hover:` family
 * is already gated behind `@media (hover: hover)`, which means touch
 * screens never show (or get stuck on) a tooltip after a tap; and
 * `:focus-visible` (not plain focus) means tabbing shows it but clicking
 * with a mouse doesn't leave it stuck open.
 *
 * `align` keeps tooltips for buttons at the far left/right of the control
 * bar from spilling off the edge of the player. The tooltip is
 * aria-hidden: the button already carries its own accessible name.
 */
export default function PlayerTooltip({
  label,
  shortcuts = [],
  align = "center",
  disabled = false,
  children,
}: {
  label: string;
  shortcuts?: string[];
  align?: keyof typeof ALIGN;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const showShortcuts = useDesktopKeyboard();

  return (
    <span className="group/tip relative inline-flex">
      {children}
      {!disabled && (
        <span
          role="tooltip"
          aria-hidden="true"
          className={`pointer-events-none absolute bottom-full z-30 mb-2 flex items-center gap-2 whitespace-nowrap rounded-lg bg-black/90 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg ring-1 ring-white/10 transition-opacity duration-150 group-hover/tip:opacity-100 group-has-[:focus-visible]/tip:opacity-100 ${ALIGN[align]}`}
        >
          {label}
          {showShortcuts &&
            shortcuts.map((s) => (
              <kbd
                key={s}
                className="rounded bg-white/15 px-1.5 py-0.5 font-sans text-[11px] font-semibold text-white/90"
              >
                {s}
              </kbd>
            ))}
        </span>
      )}
    </span>
  );
}
