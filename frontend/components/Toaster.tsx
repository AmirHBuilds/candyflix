"use client";

import { useSyncExternalStore } from "react";
import { dismissToast, getToasts, subscribe, type Toast } from "@/lib/toast";

const NO_TOASTS: Toast[] = [];

const ACCENT: Record<Toast["kind"], string> = {
  error: "border-l-accent",
  success: "border-l-highlight",
  info: "border-l-white/40",
};

/**
 * Renders the toasts from lib/toast.ts. Mount once (root layout).
 *
 * Sits at the bottom centre, lifted above the iPhone home indicator, and
 * lets taps through everywhere except on a toast itself. Errors are
 * announced assertively (role=alert), the rest politely (role=status).
 */
export default function Toaster() {
  const toasts = useSyncExternalStore(subscribe, getToasts, () => NO_TOASTS);

  return (
    <div
      aria-label="Notifications"
      role="region"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === "error" ? "alert" : "status"}
          className={`animate-fade-up pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-white/10 border-l-4 bg-surface/95 py-3 pl-4 pr-2 text-sm text-white shadow-2xl backdrop-blur ${ACCENT[t.kind]}`}
        >
          <p className="min-w-0 flex-1 py-0.5">{t.message}</p>
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() => dismissToast(t.id)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/50 hover:bg-white/10 hover:text-white pointer-coarse:h-10 pointer-coarse:w-10"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      ))}
    </div>
  );
}
