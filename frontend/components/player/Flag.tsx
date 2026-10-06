import { flagCodeFor } from "@/lib/flags";

const SIZES = {
  sm: "h-[18px] w-6 rounded",
  md: "h-8 w-11 rounded-lg",
  lg: "h-10 w-14 rounded-xl",
} as const;

// A country flag in a small rounded rectangle, picked from a subtitle's language
// code. Languages with no sensible flag get a plain globe tile rather than a wrong one.
export default function Flag({
  language,
  size = "md",
  className = "",
}: {
  language: string | null | undefined;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const code = language ? flagCodeFor(language) : null;
  return (
    <span
      aria-hidden
      data-flag={code ?? "none"}
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-white/10 ring-1 ring-inset ring-white/15 ${SIZES[size]} ${className}`}
    >
      {code ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/flags/${code}.svg`} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover" />
      ) : (
        <svg viewBox="0 0 24 24" className="h-1/2 w-auto text-white/50" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18" />
        </svg>
      )}
    </span>
  );
}
