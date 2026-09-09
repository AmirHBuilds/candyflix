"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getCurrentUser, type UserPublic } from "@/lib/auth";
import LogoutButton from "@/components/LogoutButton";
import NavSearch from "@/components/NavSearch";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/movies", label: "Movies" },
  { href: "/series", label: "Series" },
  { href: "/candy-box", label: "Candy Box" },
];

export default function Nav() {
  const pathname = usePathname();
  const [user, setUser] = useState<UserPublic | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

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

      {/* Search — always visible, full width, on every page. */}
      <div className="border-t border-white/10 px-6 py-3 sm:px-10">
        <NavSearch />
      </div>
    </header>
  );
}
