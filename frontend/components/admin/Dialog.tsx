"use client";

import { useEffect, useId, useRef } from "react";

/**
 * A small modal: Escape and a backdrop click close it, focus moves in on
 * open and back to where it was on close, Tab stays inside.
 */
export default function Dialog({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Nearly full-width, for dialogs that show something to look at. */
  wide?: boolean;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusables = () =>
      Array.from(panel?.querySelectorAll<HTMLElement>('input, select, button, [href], [tabindex]:not([tabindex="-1"])') ?? []).filter(
        (el) => !(el as HTMLButtonElement).disabled
      );
    (panel?.querySelector<HTMLElement>("[data-autofocus]") ?? focusables()[0] ?? panel)?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      } else if (e.key === "Tab") {
        const items = focusables();
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per open
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`animate-fade-up max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl border border-white/10 bg-surface p-5 shadow-2xl focus:outline-none sm:rounded-2xl ${wide ? "sm:max-w-5xl" : "sm:max-w-md"}`}
      >
        <h2 id={titleId} className="mb-4 text-lg font-semibold text-white">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

export const fieldClass =
  "h-11 w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 text-sm text-white placeholder:text-white/30 focus:border-accent focus:outline-none";
export const primaryButton =
  "h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";
export const quietButton =
  "h-10 rounded-xl bg-white/10 px-4 text-sm font-medium text-white/80 transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40";
export const dangerButton =
  "h-10 rounded-xl bg-red-500/90 px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";
