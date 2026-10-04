"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { logout, type UserPublic } from "@/lib/auth";

/**
 * The name in the header, as a button that opens a small menu:
 * Settings, the Admin panel (admins only), and Log out (which is also "switch profile" — the login
 * screen *is* the "Who's watching?" picker).
 *
 * Behaves like a proper menu: closes on outside click, Escape (focus goes
 * back to the button) and navigation; arrow keys / Home / End move
 * between items.
 */
export default function UserMenu({ user }: { user: UserPublic }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent | TouchEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open]);

  // Opening via keyboard or click puts focus on the first item.
  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  function onMenuKeyDown(e: React.KeyboardEvent) {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (e.key === "ArrowDown") next = (index + 1) % items.length;
    else if (e.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
      return;
    } else if (e.key === "Tab") {
      setOpen(false);
      return;
    }
    if (next !== null) {
      e.preventDefault();
      items[next]?.focus();
    }
  }

  async function handleLogout() {
    setLoggingOut(true);
    await logout();
    router.push("/login");
    router.refresh();
  }

  const itemClass =
    "flex w-full items-center rounded-lg px-3 py-2.5 text-left text-sm text-white/80 hover:bg-white/10 hover:text-white focus-visible:bg-white/10 focus-visible:outline-none";

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 items-center gap-2.5 rounded-full py-1 pl-1 pr-3 text-sm text-white/80 transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Avatar name={user.display_name} src={user.avatar_url} size={32} />
        <span className="max-w-32 truncate">{user.display_name}</span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          aria-hidden="true"
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Account menu"
          onKeyDown={onMenuKeyDown}
          className="animate-fade-up absolute right-0 top-full z-30 mt-2 w-60 rounded-2xl border border-white/10 bg-surface p-2 shadow-2xl"
        >
          <div className="px-3 pb-2 pt-1.5">
            <p className="truncate text-sm font-medium text-white">{user.display_name}</p>
            <p className="truncate text-xs text-white/40">
              @{user.username}
              {user.is_admin && <span className="ml-2 rounded bg-accent/15 px-1.5 py-0.5 text-accent">Admin</span>}
            </p>
          </div>
          <div className="my-1 h-px bg-white/10" />
          <Link href="/settings" role="menuitem" className={itemClass}>
            Settings
          </Link>
          {user.is_admin && (
            <Link href="/admin" role="menuitem" className={itemClass}>
              Admin panel
            </Link>
          )}
          <button type="button" role="menuitem" onClick={handleLogout} disabled={loggingOut} className={`${itemClass} disabled:opacity-50`}>
            {loggingOut ? "Logging out…" : "Log out"}
          </button>
        </div>
      )}
    </div>
  );
}
