import { redirect } from "next/navigation";
import { getBackendHealth } from "@/lib/api-client";
import { getServerCurrentUser } from "@/lib/session";
import LogoutButton from "@/components/LogoutButton";

export default async function Home() {
  const user = await getServerCurrentUser();
  if (!user) {
    redirect("/login");
  }

  let health: { status: string; database: string; redis: string } | null = null;
  let error: string | null = null;
  try {
    health = await getBackendHealth();
  } catch {
    error = "Could not reach the CandyFlix backend.";
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="text-5xl">🍬</div>
      <h1 className="text-3xl font-semibold tracking-tight">
        Good evening, {user.display_name} 🍬
      </h1>
      <p className="max-w-md text-white/60">
        You&apos;re logged in. Browsing, search, and your Candy Box arrive in
        later phases — for now this just confirms auth is working end to end.
      </p>

      <div className="mt-2 rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-4 text-sm">
        {error && <p className="text-[#FF5FA2]">{error}</p>}
        {health && (
          <ul className="space-y-1 text-left">
            <li>
              API status: <span className="text-[#8FE3C7]">{health.status}</span>
            </li>
            <li>
              Database: <span className="text-[#8FE3C7]">{health.database}</span>
            </li>
            <li>
              Redis: <span className="text-[#8FE3C7]">{health.redis}</span>
            </li>
          </ul>
        )}
      </div>

      <LogoutButton />
    </main>
  );
}
