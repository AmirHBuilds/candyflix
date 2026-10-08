import type { ReactNode } from "react";

export type BannerContent = { enabled: boolean; title: string; text: string };

// Three little scenes, one per slot, drawn in the theme's own colours (accent / secondary / highlight),
// so they follow whichever theme a person picked. Decorative only: the words carry the meaning.
const PICTURES: ReactNode[] = [
  // 0 — subtitles that fit: a screen, two caption bars, a sync badge
  <svg key="subs" viewBox="0 0 160 120" className="h-full w-full" aria-hidden>
    <rect x="14" y="14" width="132" height="84" rx="14" className="fill-white/[0.07] stroke-white/20" strokeWidth="2" />
    <circle cx="36" cy="34" r="5" className="fill-highlight/70" />
    <rect x="48" y="31" width="40" height="6" rx="3" className="fill-white/20" />
    <rect x="30" y="64" width="84" height="12" rx="6" className="fill-accent" />
    <rect x="42" y="82" width="60" height="9" rx="4.5" className="fill-secondary/80" />
    <g transform="translate(120 82)">
      <circle r="20" className="fill-canvas stroke-highlight" strokeWidth="3" />
      <path d="M-9 -3a10 10 0 0 1 17 -4M9 3a10 10 0 0 1 -17 4" className="fill-none stroke-highlight" strokeWidth="3" strokeLinecap="round" />
      <path d="M9 -11v5h-5M-9 11v-5h5" className="fill-none stroke-highlight" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </g>
    <path d="M140 12l2.5 6 6 2.5-6 2.5-2.5 6-2.5-6-6-2.5 6-2.5z" className="fill-secondary" />
    <circle cx="20" cy="106" r="3" className="fill-accent/70" />
  </svg>,
  // 1 — right where you left off: a play button over a progress bar
  <svg key="resume" viewBox="0 0 160 120" className="h-full w-full" aria-hidden>
    <circle cx="80" cy="50" r="38" className="fill-accent/20" />
    <circle cx="80" cy="50" r="30" className="fill-accent" />
    <path d="M72 36v28l24-14z" className="fill-on-accent" strokeLinejoin="round" />
    <rect x="22" y="100" width="116" height="9" rx="4.5" className="fill-white/15" />
    <rect x="22" y="100" width="70" height="9" rx="4.5" className="fill-highlight" />
    <circle cx="92" cy="104.5" r="8" className="fill-white stroke-highlight" strokeWidth="3" />
    <path d="M132 26a12 12 0 1 0 9 19 9.5 9.5 0 0 1 -9 -19z" className="fill-secondary" />
    <path d="M24 30l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" className="fill-highlight" />
    <circle cx="140" cy="76" r="3" className="fill-accent/70" />
  </svg>,
  // 2 — make it yours: a paint palette with a star
  <svg key="mine" viewBox="0 0 160 120" className="h-full w-full" aria-hidden>
    <path
      d="M80 14C44 14 18 38 18 66c0 26 22 40 40 40 12 0 14-8 10-15-4-8 0-16 10-16h22c20 0 34-10 34-28 0-22-24-33-54-33z"
      className="fill-white/[0.08] stroke-white/25"
      strokeWidth="2"
    />
    <circle cx="50" cy="46" r="9" className="fill-accent" />
    <circle cx="80" cy="34" r="9" className="fill-secondary" />
    <circle cx="110" cy="46" r="9" className="fill-highlight" />
    <circle cx="40" cy="74" r="8" className="fill-white/80" />
    <circle cx="68" cy="88" r="3" className="fill-white/30" />
    <path d="M132 70l4 9 10 1-7.5 6.5 2.5 9.5-9-5.5-9 5.5 2.5-9.5-7.5-6.5 10-1z" className="fill-highlight" />
    <path d="M136 20l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" className="fill-accent" />
  </svg>,
];

export default function HomeBanner({ banner, slot }: { banner: BannerContent; slot: 0 | 1 | 2 }) {
  return (
    <aside
      aria-label={banner.title}
      data-banner={slot}
      className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-accent/[0.14] via-white/[0.03] to-secondary/[0.12]"
    >
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-secondary/10 blur-2xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-12 -left-8 h-36 w-36 rounded-full bg-accent/10 blur-2xl" aria-hidden />
      <div className={`relative flex flex-col items-center gap-5 p-6 sm:gap-8 sm:p-8 sm:flex-row`}>
        <div className="h-28 w-40 shrink-0 motion-safe:animate-[bannerFloat_6s_ease-in-out_infinite] sm:h-32 sm:w-44">{PICTURES[slot]}</div>
        <div className="min-w-0 text-center sm:text-left">
          <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold text-white sm:text-2xl">{banner.title}</h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/65 sm:text-base">{banner.text}</p>
        </div>
      </div>
    </aside>
  );
}
