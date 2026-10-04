"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Avatar from "@/components/Avatar";
import { getCurrentUser, listUsers, login, type UserPublic } from "@/lib/auth";

// Deterministic, non-hardcoded accent per profile — cycles through the
// Candy at Night palette by position, so any number of real users
// (stored in the database, not hardcoded here) gets a distinct look.
const PROFILE_COLORS = ["#FF5FA2", "#C9A6FF", "#8FE3C7", "#FFD166"];

export default function LoginPage() {
  const router = useRouter();

  const [users, setUsers] = useState<UserPublic[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedUser, setSelectedUser] = useState<UserPublic | null>(null);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // If there's already a valid session, skip straight past login.
  useEffect(() => {
    getCurrentUser()
      .then((user) => {
        if (user) router.replace("/");
      })
      .catch(() => {
        /* not logged in — stay on this page */
      });
  }, [router]);

  useEffect(() => {
    listUsers()
      .then(setUsers)
      .catch(() => setLoadError("Couldn't load profiles. Is the backend running?"));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedUser) return;
    setSubmitting(true);
    setAuthError(null);
    try {
      await login(selectedUser.username, password);
      router.push("/");
    } catch {
      setAuthError("Incorrect password. Try again.");
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-10 px-6 text-center">
      <div className="flex flex-col items-center gap-2">
        <div className="text-4xl">🍬</div>
        <h1 className="text-2xl font-semibold tracking-tight">CandyFlix</h1>
      </div>

      {!selectedUser && (
        <div className="flex flex-col items-center gap-8">
          <h2 className="text-lg text-white/70">Who&apos;s watching?</h2>

          {loadError && <p className="text-sm text-accent">{loadError}</p>}

          {!users && !loadError && (
            <p className="text-sm text-white/40">Loading profiles…</p>
          )}

          {users && users.length === 0 && (
            <p className="max-w-xs text-sm text-white/50">
              No profiles yet. Ask whoever set up CandyFlix to create one for
              you.
            </p>
          )}

          {users && users.length > 0 && (
            <div className="flex flex-wrap justify-center gap-6">
              {users.map((user, i) => (
                <button
                  key={user.id}
                  onClick={() => {
                    setSelectedUser(user);
                    setAuthError(null);
                  }}
                  className="group flex flex-col items-center gap-3"
                >
                  <Avatar
                    name={user.display_name}
                    src={user.avatar_url}
                    size={80}
                    color={PROFILE_COLORS[i % PROFILE_COLORS.length]}
                    className="transition-transform duration-150 group-hover:scale-105"
                  />
                  <span className="text-sm text-white/80">{user.display_name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {selectedUser && (
        <form
          onSubmit={handleSubmit}
          className="flex w-full max-w-xs flex-col items-center gap-5"
        >
          <Avatar
            name={selectedUser.display_name}
            src={selectedUser.avatar_url}
            size={64}
            color={PROFILE_COLORS[Math.max(0, (users ?? []).findIndex((u) => u.id === selectedUser.id)) % PROFILE_COLORS.length]}
          />
          <p className="text-white/80">{selectedUser.display_name}</p>

          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-center text-white placeholder-white/30 outline-none focus:border-accent/60"
          />

          {authError && <p className="text-sm text-accent">{authError}</p>}

          <button
            type="submit"
            disabled={submitting || password.length === 0}
            className="w-full rounded-xl bg-accent py-3 font-medium text-on-accent transition-opacity disabled:opacity-40"
          >
            {submitting ? "Checking…" : "Continue"}
          </button>

          <button
            type="button"
            onClick={() => {
              setSelectedUser(null);
              setPassword("");
              setAuthError(null);
            }}
            className="text-sm text-white/40 hover:text-white/70"
          >
            ← Back
          </button>
        </form>
      )}
    </main>
  );
}
