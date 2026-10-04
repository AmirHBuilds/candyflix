"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import { getCurrentUser, onUserChanged, type UserPublic } from "@/lib/auth";
import LogoutButton from "@/components/LogoutButton";
import UserMenu from "@/components/UserMenu";
import NavSearch from "@/components/NavSearch";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/movies", label: "Movies" },
  { href: "/series", label: "Series" },
  { href: "/candy-box", label: "Candy Box" },
];

// The search box is the same full-width row on every page. On the
// player it starts hidden — a video's controls sit right under the
// header, so that vertical space is worth reclaiming — and this
// icon (which turns into a ✕ while the box is open) toggles it.
function SearchToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label={open ? "Close search" : "Search"}
      aria-expanded={open}
      onClick={onToggle}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white/80 hover:bg-white/10"
    >
      {open ? (
        <span aria-hidden="true" className="text-lg leading-none">
          ✕
        </span>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}

export default function Nav() {
  const pathname = usePathname();
  const [user, setUser] = useState<UserPublic | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [playerSearchOpen, setPlayerSearchOpen] = useState(false);

  // The player routes (/watch/movie/[id], /watch/tv/[id]/[season]/[episode])
  // are the only ones where the search row starts hidden behind the
  // header icon (see SearchToggle above).
  const isPlayerPage = pathname.startsWith("/watch/");
  const showSearchRow = !isPlayerPage || playerSearchOpen;

  useEffect(() => {
    const load = () =>
      getCurrentUser()
        .then(setUser)
        .catch(() => setUser(null));
    load();
    // Changing your name or picture on the account page updates the header.
    return onUserChanged(load);
  }, []);

  // Close the mobile menu and the player's search box whenever the
  // route changes (e.g. after picking a search result).
  useEffect(() => {
    setMenuOpen(false);
    setPlayerSearchOpen(false);
  }, [pathname]);

  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-canvas/95 backdrop-blur">
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
          {isPlayerPage && (
            <SearchToggle open={playerSearchOpen} onToggle={() => setPlayerSearchOpen((v) => !v)} />
          )}

          {user && (
            <div className="hidden sm:block">
              <UserMenu user={user} />
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
            <div className="border-t border-white/10">
              <div className="flex items-center gap-3 px-6 pb-1 pt-4">
                <Avatar name={user.display_name} src={user.avatar_url} size={28} />
                <p className="text-sm text-white/40">{user.display_name}</p>
              </div>
              <Link
                href="/settings"
                className={`block px-6 py-4 text-base ${pathname.startsWith("/settings") ? "text-white" : "text-white/60"}`}
              >
                Settings
              </Link>
              {user.is_admin && (
                <Link
                  href="/admin"
                  className={`block px-6 py-4 text-base ${pathname.startsWith("/admin") ? "text-white" : "text-white/60"}`}
                >
                  Admin panel
                </Link>
              )}
              <LogoutButton className="block w-full px-6 py-4 text-left text-base text-white/60 disabled:opacity-40" />
            </div>
          )}
        </nav>
      )}

      {/* Search — the same full-width row everywhere; on the player
          only while toggled open. Below `sm` (where the nav collapses
          into the hamburger) it runs edge to edge with no side padding
          — the side margins there just read as clutter. */}
      {showSearchRow && (
        <div className="border-t border-white/10 px-0 py-3 sm:px-10">
          <NavSearch autoFocus={isPlayerPage} />
        </div>
      )}
    </header>
  );
}
