import Link from "next/link";

type Icon = "box" | "play" | "search" | "film";

// Plain stroke icons, drawn once here so every empty state looks related.
const ICON_PATHS: Record<Icon, React.ReactNode> = {
  box: (
    <>
      <path d="M21 8l-9-5-9 5 9 5 9-5z" />
      <path d="M3 8v8l9 5 9-5V8" />
      <path d="M12 13v8" />
    </>
  ),
  play: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 8.5v7l6-3.5-6-3.5z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </>
  ),
  film: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
    </>
  ),
};

export const stateActionClass =
  "inline-flex h-11 items-center justify-center rounded-xl bg-accent px-6 text-sm font-semibold text-on-accent transition-colors hover:bg-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/**
 * "There's nothing here (yet)" — a friendly centred block instead of a
 * bare grey line. `action` is optional: a link (`href`) for sending the
 * person somewhere useful, or a button (`onClick`, client callers only)
 * for things like "Clear filters".
 */
export default function EmptyState({
  icon = "film",
  title,
  message,
  action,
  compact = false,
}: {
  icon?: Icon;
  title: string;
  message: string;
  action?: { label: string; href: string } | { label: string; onClick: () => void };
  /** Less vertical padding, for use inside a page that has other content. */
  compact?: boolean;
}) {
  return (
    <div className={`animate-fade-up flex flex-col items-center gap-4 text-center ${compact ? "py-10" : "py-20"}`}>
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/[0.05] text-accent">
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
          {ICON_PATHS[icon]}
        </svg>
      </div>
      <div className="flex flex-col gap-1.5">
        <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold text-white">{title}</h2>
        <p className="mx-auto max-w-sm text-sm text-white/50">{message}</p>
      </div>
      {action &&
        ("href" in action ? (
          <Link href={action.href} className={stateActionClass}>
            {action.label}
          </Link>
        ) : (
          <button type="button" onClick={action.onClick} className={stateActionClass}>
            {action.label}
          </button>
        ))}
    </div>
  );
}
