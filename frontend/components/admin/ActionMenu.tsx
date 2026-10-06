"use client";

import { useEffect, useRef, useState } from "react";

export type MenuAction = { label: string; ariaLabel: string; onSelect: () => void; danger?: boolean };

// A "⋯" button that opens a small list of actions for one row. Closes on choosing, on Esc and on a
// click anywhere else. Keeps long rows of buttons (View, Edit, Reset password, …) out of the way.
export default function ActionMenu({ label, actions }: { label: string; actions: MenuAction[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-48 overflow-hidden rounded-xl border border-white/10 bg-canvas py-1 shadow-2xl"
        >
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              role="menuitem"
              aria-label={a.ariaLabel}
              onClick={() => {
                setOpen(false);
                a.onSelect();
              }}
              className={`block w-full px-4 py-2.5 text-left text-sm transition-colors hover:bg-white/10 ${a.danger ? "text-red-300" : "text-white/90"}`}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
