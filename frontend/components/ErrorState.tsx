"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import Link from "next/link";
import { stateActionClass } from "@/components/EmptyState";

const retryButtonClass = `${stateActionClass} disabled:opacity-60`;

// Kept separate so the router hook is only used when this mode is
// actually rendered — an ErrorState with its own `onRetry` works without
// a Next app router (e.g. inside client components under test).
function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      onClick={() => startTransition(() => router.refresh())}
      disabled={pending}
      className={retryButtonClass}
    >
      {pending ? "Retrying…" : "Try again"}
    </button>
  );
}

/**
 * "Something failed" with a way out. Two retry modes:
 * - `onRetry`: the caller knows how to redo the thing (an error
 *   boundary's `reset`, or a client component re-running its fetch);
 * - otherwise "Try again" refreshes the current route, which re-runs the
 *   server-side data loading — what a server-rendered page needs, since
 *   it has no client callback to offer.
 * Pass `retry={false}` for errors where trying again can't help.
 */
export default function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  retry = true,
  secondary,
  detail,
  compact = false,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  retry?: boolean;
  secondary?: { label: string; href: string };
  /** Small print under the message (e.g. an error reference id). */
  detail?: string;
  compact?: boolean;
}) {
  return (
    <div
      role="alert"
      className={`animate-fade-up flex flex-col items-center gap-4 text-center ${compact ? "py-10" : "py-20"}`}
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent/10 text-accent">
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 3l10 18H2L12 3z" />
          <path d="M12 10v5M12 18h.01" />
        </svg>
      </div>
      <div className="flex flex-col gap-1.5">
        <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold text-white">{title}</h2>
        <p className="mx-auto max-w-sm text-sm text-white/50">{message}</p>
        {detail && <p className="text-xs text-white/30">{detail}</p>}
      </div>
      {(retry || secondary) && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {retry &&
            (onRetry ? (
              <button type="button" onClick={onRetry} className={retryButtonClass}>
                Try again
              </button>
            ) : (
              <RefreshButton />
            ))}
          {secondary && (
            <Link
              href={secondary.href}
              className="inline-flex h-11 items-center justify-center rounded-xl border border-white/15 px-6 text-sm font-medium text-white/80 transition-colors hover:bg-white/5"
            >
              {secondary.label}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
