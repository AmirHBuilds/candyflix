"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { logout } from "@/lib/auth";
import { startProgress } from "@/components/RouteProgress";

export default function LogoutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    await logout();
    startProgress();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={handleLogout}
      disabled={loggingOut}
      className={
        className ?? "text-sm text-white/50 underline-offset-4 hover:text-white/80 hover:underline disabled:opacity-40"
      }
    >
      {loggingOut ? "Logging out…" : "Log out"}
    </button>
  );
}
