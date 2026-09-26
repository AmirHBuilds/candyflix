"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getCurrentUser, type UserPublic } from "@/lib/auth";
import LogoutButton from "@/components/LogoutButton";
import NavSearch from "@/components/NavSearch";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/movies", label: "Movies" },
  { href: "/series", label: "Series" },
  { href: "/candy-box", label: "Candy Box" },
];

// The full-width search row (below) is genuinely full-width, which is
// fine everywhere except the player: a video's controls sit right under
// the header there, so that much vertical space is worth reclaiming.
// PlayerHeaderSearch collapses the same NavSearch down to an icon that
// expands in place — at every breakpoint, not just mobile, since the
// player is the one context where "compact by default" wins even on
// desktop.
function PlayerHeaderSearch() {
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expanded) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [expanded]);

  if (!expanded) {
    return (
      <button
        type="button"
        aria-label="Search"
        onClick={() => setExpanded(true)}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white/80 hover:bg-white/10"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
        </svg>
      </button>
    );
  }

  return (
    <div ref={containerRef} className="flex w-48 items-center gap-1 sm:w-80">
      <div className="min-w-0 flex-1">
        <NavSearch />
      </div>
      <button
        type="button"
        aria-label="Close search"
        onClick={() => setExpanded(false)}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white/60 hover:bg-white/10"
      >
        ✕
      </button>
    </div>
  );
}

export default function Nav() {
  const pathname = usePathname();
  const [user, setUser] = useState<UserPublic | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // The player routes (/watch/movie/[id], /watch/tv/[id]/[season]/[episode])
  // are the only ones that trade the full-width search row for the
  // compact icon above.
  const isPlayerPage = pathname.startsWith("/watch/");

  useEffect(() => {
    getCurrentUser()
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  // Close the mobile menu whenever the route changes.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-[#0B0B12]/95 backdrop-blur">
      <div className="flex items-center gap-4 px-6 py-4 sm:px-10">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          🍬 CandyFlix
        </Link>

        <nav className="hidden items-center gap-5 text-sm sm:flex">
          {LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={active ? "text-white" : "text-white/50 hover:text-white/80"}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {isPlayerPage && <PlayerHeaderSearch />}

          {user && (
            <div className="hidden items-center gap-3 text-sm text-white/60 sm:flex">
              <span>{user.display_name}</span>
              <LogoutButton />
            </div>
          )}

          <button
            type="button"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-10 w-10 items-center justify-center rounded-full text-xl text-white/80 hover:bg-white/10 sm:hidden"
          >
            {menuOpen ? "✕" : "☰"}
          </button>
        </div>
      </div>

      {/* Mobile menu — one clear list, big tap targets, no nesting. */}
      {menuOpen && (
        <nav className="flex flex-col border-t border-white/10 sm:hidden">
          {LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`px-6 py-4 text-base ${
                  active ? "text-white" : "text-white/60"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
          {user && (
            <div className="flex items-center justify-between border-t border-white/10 px-6 py-4 text-sm text-white/60">
              <span>{user.display_name}</span>
              <LogoutButton />
            </div>
          )}
        </nav>
      )}

      {/* Search — full width, on every page except the player (see
          PlayerHeaderSearch above for that one). */}
      {!isPlayerPage && (
        <div className="border-t border-white/10 px-6 py-3 sm:px-10">
          <NavSearch />
        </div>
      )}
    </header>
  );
}
