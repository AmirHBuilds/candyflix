"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getCurrentUser, type UserPublic } from "@/lib/auth";
import LogoutButton from "@/components/LogoutButton";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/movies", label: "Movies" },
  { href: "/series", label: "Series" },
  { href: "/candy-box", label: "Candy Box" },
];

export default function Nav() {
  const pathname = usePathname();
  const [user, setUser] = useState<UserPublic | null>(null);

  useEffect(() => {
    getCurrentUser()
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  return (
    <header className="sticky top-0 z-10 flex items-center gap-6 border-b border-white/10 bg-[#0B0B12]/90 px-6 py-4 backdrop-blur sm:px-10">
      <Link href="/" className="text-lg font-semibold tracking-tight">
        🍬 CandyFlix
      </Link>

      <nav className="flex flex-1 items-center gap-5 text-sm">
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

      <Link
        href="/search"
        aria-label="Search"
        className={
          pathname === "/search"
            ? "text-white"
            : "text-white/50 hover:text-white/80"
        }
      >
        Search
      </Link>

      {user && (
        <div className="flex items-center gap-3 text-sm text-white/60">
          <span>{user.display_name}</span>
          <LogoutButton />
        </div>
      )}
    </header>
  );
}
