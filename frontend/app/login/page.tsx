"use client";

import CandyIcon from "@/components/CandyIcon";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AdminBadge from "@/components/AdminBadge";
import Avatar from "@/components/Avatar";
import ProfilePicker from "@/components/ProfilePicker";
import { getCurrentUser, listUsers, login, resendLoginCode, verifyLoginCode, type UserPublic } from "@/lib/auth";
import { DEFAULT_BADGE, getBadge, LOVE_NOTE, type BadgeContent } from "@/lib/site";
import { startProgress } from "@/components/RouteProgress";

// Deterministic, non-hardcoded accent per profile — cycles through the
// Candy at Night palette by position, so any number of real users
// (stored in the database, not hardcoded here) gets a distinct look.
const PROFILE_COLORS = ["#FF5FA2", "#C9A6FF", "#8FE3C7", "#FFD166"];

export default function LoginPage() {
  const router = useRouter();

  const [users, setUsers] = useState<UserPublic[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [badge, setBadge] = useState<BadgeContent>(DEFAULT_BADGE);

  const [selectedUser, setSelectedUser] = useState<UserPublic | null>(null);
  // "Sign in with a username": for anyone whose picture isn't on the screen (or who just prefers typing).
  const [manual, setManual] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  // Set when the password was right and a code was sent to their Telegram.
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

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

  useEffect(() => {
    getBadge().then(setBadge);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = manual ? username.trim() : selectedUser?.username;
    if (!name) return;
    setSubmitting(true);
    setAuthError(null);
    try {
      const result = await login(name, password);
      if (result.kind === "code") {
        setChallenge(result.challenge);
        setCode("");
        setPassword("");
      } else {
        startProgress();
        router.push("/");
      }
    } catch (err) {
      // 401 is the only "wrong password"; anything else (like Telegram being down) says what happened.
      const message = err instanceof Error ? err.message : "";
      setAuthError(
        message && message !== "Incorrect username or password"
          ? message
          : manual
            ? "That username and password don't match. Try again."
            : "Incorrect password. Try again."
      );
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCode(e: React.FormEvent) {
    e.preventDefault();
    if (!challenge) return;
    setSubmitting(true);
    setAuthError(null);
    try {
      await verifyLoginCode(challenge, code.trim());
      startProgress();
      router.push("/");
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "That code isn't right.");
      setCode("");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    if (!challenge) return;
    setAuthError(null);
    setNotice(null);
    try {
      await resendLoginCode(challenge);
      setNotice("A new code is on its way.");
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Couldn't send another code.");
    }
  }

  function backToProfiles() {
    setSelectedUser(null);
    setManual(false);
    setUsername("");
    setPassword("");
    setChallenge(null);
    setCode("");
    setAuthError(null);
    setNotice(null);
  }

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center gap-10 px-6 pb-14 text-center">
      <div className="flex flex-col items-center gap-2">
        <CandyIcon size={56} />
        <h1 className="text-2xl font-semibold tracking-tight">CandyFlix</h1>
      </div>

      {!selectedUser && !manual && (
        <div className="flex w-full flex-col items-center gap-8">
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
            <ProfilePicker
              users={users}
              badge={badge}
              colors={PROFILE_COLORS}
              onPick={(user) => {
                setSelectedUser(user);
                setAuthError(null);
              }}
            />
          )}

          <button
            type="button"
            onClick={() => {
              setManual(true);
              setAuthError(null);
            }}
            className="group flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white/60 transition-colors hover:border-white/25 hover:bg-white/[0.07] hover:text-white"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-accent" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
            </svg>
            Sign in with a username
          </button>
        </div>
      )}

      {(selectedUser || manual) && challenge && (
        <form onSubmit={handleCode} className="flex w-full max-w-xs flex-col items-center gap-5">
          <span className="relative mt-6 block text-4xl" aria-hidden="true">
            🔐
          </span>
          <p className="text-white/80">Enter the code we sent to your Telegram</p>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            aria-label="Sign-in code"
            placeholder="······"
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-center text-2xl tracking-[0.5em] text-white placeholder-white/30 outline-none focus:border-accent/60"
          />
          {authError && <p role="alert" className="text-sm text-accent">{authError}</p>}
          {notice && <p className="text-sm text-white/60">{notice}</p>}
          <button
            type="submit"
            disabled={submitting || code.length !== 6}
            className="w-full rounded-xl bg-accent py-3 font-medium text-on-accent transition-opacity disabled:opacity-40"
          >
            {submitting ? "Checking…" : "Sign in"}
          </button>
          <button type="button" onClick={handleResend} className="text-sm text-white/50 hover:text-white/80">
            Send a new code
          </button>
          <button type="button" onClick={backToProfiles} className="text-sm text-white/40 hover:text-white/70">
            ← Back
          </button>
        </form>
      )}

      {manual && !challenge && (
        <form onSubmit={handleSubmit} className="flex w-full max-w-xs flex-col items-center gap-4">
          <h2 className="mt-2 text-lg text-white/70">Sign in with your username</h2>
          <input
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoCapitalize="none"
            autoComplete="username"
            aria-label="Username"
            placeholder="Username"
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-center text-white placeholder-white/30 outline-none focus:border-accent/60"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            aria-label="Password"
            placeholder="Password"
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-center text-white placeholder-white/30 outline-none focus:border-accent/60"
          />
          {authError && <p role="alert" className="text-sm text-accent">{authError}</p>}
          <button
            type="submit"
            disabled={submitting || !username.trim() || password.length === 0}
            className="w-full rounded-xl bg-accent py-3 font-medium text-on-accent transition-opacity disabled:opacity-40"
          >
            {submitting ? "Checking…" : "Continue"}
          </button>
          <button type="button" onClick={backToProfiles} className="text-sm text-white/40 hover:text-white/70">
            ← Back to profiles
          </button>
        </form>
      )}

      {selectedUser && !challenge && (
        <form
          onSubmit={handleSubmit}
          className="flex w-full max-w-xs flex-col items-center gap-5"
        >
          <span className="relative mt-6 block" style={{ width: 64, height: 64 }}>
            <Avatar
              name={selectedUser.display_name}
              src={selectedUser.avatar_url}
              size={64}
              color={PROFILE_COLORS[Math.max(0, (users ?? []).findIndex((u) => u.id === selectedUser.id)) % PROFILE_COLORS.length]}
            />
            {selectedUser.is_admin && <AdminBadge badge={badge} size={64} />}
          </span>
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
      <footer className="absolute inset-x-0 bottom-5 px-6 text-center text-xs text-white/45">{LOVE_NOTE}</footer>
    </main>
  );
}
