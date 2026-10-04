"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const SETTINGS_SECTIONS = [
  { href: "/settings/appearance", label: "Appearance" },
  { href: "/settings/playback", label: "Playback" },
  { href: "/settings/subtitles", label: "Subtitles" },
  { href: "/settings/account", label: "Account" },
  { href: "/settings/privacy", label: "Privacy & data" },
  { href: "/settings/about", label: "About" },
] as const;

/**
 * Section switcher. A sidebar from `md` up; on phones a horizontally
 * scrollable strip of pills (no extra screen taken, thumb-friendly).
 */
export default function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings sections" className="md:w-52 md:shrink-0">
      <ul className="-mx-6 flex gap-2 overflow-x-auto px-6 pb-2 md:mx-0 md:flex-col md:gap-1 md:overflow-visible md:px-0 md:pb-0 [scrollbar-width:none]">
        {SETTINGS_SECTIONS.map((section) => {
          const active = pathname === section.href;
          return (
            <li key={section.href} className="shrink-0">
              <Link
                href={section.href}
                aria-current={active ? "page" : undefined}
                className={`block whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
                  active ? "bg-accent/15 text-accent" : "text-white/60 hover:bg-white/5 hover:text-white"
                }`}
              >
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
