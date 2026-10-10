"use client";

import { useEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { SettingRow, SettingsCard, Toggle } from "@/components/settings/controls";
import { changePassword, getTwoFactor, removeAvatar, startTwoFactor, stopTwoFactor, updateDisplayName, uploadAvatar, type TwoFactorStatus } from "@/lib/account";
import type { UserPublic } from "@/lib/auth";
import { showToast } from "@/lib/toast";

const inputClass =
  "h-11 w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 text-sm text-white placeholder:text-white/30 focus:border-accent focus:outline-none sm:w-64";
const buttonClass =
  "h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";
const quietButtonClass =
  "h-10 rounded-xl bg-white/10 px-4 text-sm font-medium text-white/80 transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40";

export default function AccountSettingsForm({ user: initial }: { user: UserPublic }) {
  const [user, setUser] = useState(initial);
  return (
    <>
      <ProfileCard user={user} onChange={setUser} />
      <PasswordCard />
      <SecurityCard />
    </>
  );
}

function ProfileCard({ user, onChange }: { user: UserPublic; onChange: (u: UserPublic) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(user.display_name);
  const [savingName, setSavingName] = useState(false);
  const nameChanged = name.trim() !== user.display_name;

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // so picking the same file again still fires
    if (!file) return;
    setBusy(true);
    try {
      onChange(await uploadAvatar(file));
      showToast("Profile picture updated.", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't upload that picture.");
    } finally {
      setBusy(false);
    }
  }

  async function onRemove() {
    setBusy(true);
    try {
      onChange(await removeAvatar());
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't remove your picture.");
    } finally {
      setBusy(false);
    }
  }

  async function onSaveName(e: React.FormEvent) {
    e.preventDefault();
    if (!nameChanged || savingName) return;
    setSavingName(true);
    try {
      const updated = await updateDisplayName(name.trim());
      onChange(updated);
      setName(updated.display_name);
      showToast("Name updated.", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't save your name.");
    } finally {
      setSavingName(false);
    }
  }

  return (
    <SettingsCard title="Profile" description="How you appear to everyone on this server.">
      <SettingRow label="Profile picture" description="JPEG, PNG, WebP or GIF, up to 5 MB. It's cropped to a square.">
        <div className="flex items-center gap-4">
          <Avatar name={user.display_name} src={user.avatar_url} size={64} />
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              aria-label="Choose a profile picture"
              className="sr-only"
              onChange={onPick}
            />
            <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className={quietButtonClass}>
              {busy ? "Working…" : user.avatar_url ? "Change" : "Upload"}
            </button>
            {user.avatar_url && (
              <button type="button" disabled={busy} onClick={onRemove} className={quietButtonClass}>
                Remove
              </button>
            )}
          </div>
        </div>
      </SettingRow>

      <form onSubmit={onSaveName}>
        <SettingRow label="Display name" htmlFor="display-name" description="Shown in the header and on the sign-in screen.">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="display-name"
              value={name}
              maxLength={50}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
            <button type="submit" disabled={!nameChanged || !name.trim() || savingName} className={buttonClass}>
              {savingName ? "Saving…" : "Save"}
            </button>
          </div>
        </SettingRow>
      </form>

      <SettingRow
        label="Username"
        htmlFor="username"
        description="Only an admin can change this, because it's what you sign in with."
      >
        <input id="username" value={user.username} readOnly aria-readonly="true" className={`${inputClass} cursor-not-allowed opacity-60`} />
      </SettingRow>
    </SettingsCard>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = confirm.length > 0 && next !== confirm;
  const ready = current.length > 0 && next.length >= 8 && next === confirm && !saving;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setSaving(true);
    setError(null);
    try {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      showToast("Password changed. Your other devices were signed out.", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't change your password.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsCard title="Password" description="Changing it signs you out everywhere except this device.">
      <form onSubmit={onSubmit} className="space-y-4 px-5 py-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="flex flex-col gap-1.5 text-sm text-white/70">
            Current password
            <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={`${inputClass} sm:w-full`} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-white/70">
            New password
            <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={`${inputClass} sm:w-full`} />
            <span className="text-xs text-white/40">At least 8 characters.</span>
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-white/70">
            Confirm new password
            <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={`${inputClass} sm:w-full`} />
            {mismatch && <span role="alert" className="text-xs text-red-400">Doesn&apos;t match.</span>}
          </label>
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}
        <button type="submit" disabled={!ready} className={buttonClass}>
          {saving ? "Changing…" : "Change password"}
        </button>
      </form>
    </SettingsCard>
  );
}

function SecurityCard() {
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [step, setStep] = useState<"idle" | "password" | "link">("idle");
  const [off, setOff] = useState(false);
  const [password, setPassword] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getTwoFactor().then(setStatus).catch(() => setStatus({ available: false, enabled: false }));
  }, []);

  // While the link is open, notice when they have pressed Start in Telegram.
  useEffect(() => {
    if (step !== "link") return;
    const t = setInterval(() => {
      getTwoFactor()
        .then((s) => {
          if (s.enabled) {
            setStatus(s);
            setStep("idle");
            setLink(null);
            showToast("Two-step sign-in is on.", "success");
          }
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [step]);

  function reset() {
    setStep("idle");
    setOff(false);
    setPassword("");
    setLink(null);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (off) {
        await stopTwoFactor(password);
        setStatus((s) => s && { ...s, enabled: false });
        showToast("Two-step sign-in is off.", "success");
        reset();
      } else {
        setLink(await startTwoFactor(password));
        setPassword("");
        setStep("link");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const description = !status
    ? "Checking…"
    : !status.available
      ? "Not available: this server has no Telegram bot set up."
      : status.enabled
        ? "On. After your password you also type a code the CandyFlix bot sends to your Telegram."
        : "After your password you also type a code the CandyFlix bot sends to your Telegram.";

  return (
    <SettingsCard title="Security">
      <SettingRow label="Two-step sign-in" description={description}>
        {status?.available && step === "idle" && (
          <Toggle
            checked={status.enabled}
            label="Two-step sign-in"
            onChange={() => {
              setOff(status.enabled);
              setStep("password");
            }}
          />
        )}
        {status && !status.available && <Toggle checked={false} onChange={() => {}} label="Two-step sign-in" disabled />}
      </SettingRow>

      {step === "password" && (
        <form onSubmit={submit} className="space-y-3 px-5 py-4">
          <p className="text-sm text-white/60">{off ? "Enter your password to turn it off." : "Enter your password to continue."}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-label="Your password"
              autoComplete="current-password"
              className={inputClass}
            />
            <button type="submit" disabled={!password || busy} className={buttonClass}>
              {busy ? "Checking…" : off ? "Turn off" : "Continue"}
            </button>
            <button type="button" onClick={reset} className={quietButtonClass}>
              Cancel
            </button>
          </div>
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        </form>
      )}

      {step === "link" && link && (
        <div className="space-y-3 px-5 py-4">
          <p className="text-sm text-white/70">
            Open the bot in Telegram and press <b>Start</b>. This page notices by itself. The link works once, for 10 minutes.
          </p>
          <a href={link} target="_blank" rel="noopener noreferrer" className={`${buttonClass} inline-flex items-center`}>
            Open Telegram
          </a>
          <button type="button" onClick={reset} className={`${quietButtonClass} ml-2`}>
            Cancel
          </button>
        </div>
      )}
    </SettingsCard>
  );
}
