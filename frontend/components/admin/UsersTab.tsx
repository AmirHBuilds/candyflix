"use client";

import { useCallback, useEffect, useState } from "react";
import ActionMenu from "@/components/admin/ActionMenu";
import Avatar from "@/components/Avatar";
import Dialog, { dangerButton, fieldClass, primaryButton, quietButton } from "@/components/admin/Dialog";
import {
  createAdminUser,
  deleteAdminUser,
  listAdminUsers,
  resetAdminPassword,
  switchOffTwoFactor,
  updateAdminUser,
  type AdminUser,
} from "@/lib/admin";
import { boxNameFor } from "@/lib/box-name";
import { showToast } from "@/lib/toast";

type Modal =
  | { kind: "create" }
  | { kind: "edit"; user: AdminUser }
  | { kind: "password"; user: AdminUser }
  | { kind: "delete"; user: AdminUser };

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export type UserFilter = "admins" | "disabled" | "active";
export const FILTER_TITLES: Record<UserFilter, string> = {
  admins: "Admins",
  disabled: "Disabled accounts",
  active: "Signed in during the last 7 days",
};
const WEEK_MS = 7 * 24 * 3600 * 1000;

export function applyFilter(users: AdminUser[], filter?: UserFilter): AdminUser[] {
  if (filter === "admins") return users.filter((u) => u.is_admin);
  if (filter === "disabled") return users.filter((u) => u.is_disabled);
  if (filter === "active") return users.filter((u) => u.last_login_at && Date.now() - new Date(u.last_login_at).getTime() <= WEEK_MS);
  return users;
}

export default function UsersTab({
  currentUserId,
  onView,
  filter,
  onBack,
  backLabel = "Overview",
}: {
  currentUserId: string;
  onView?: (id: string) => void;
  filter?: UserFilter;
  onBack?: () => void;
  backLabel?: string;
}) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);

  const load = useCallback(async () => {
    try {
      setUsers(await listAdminUsers());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load users.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleDisabled(user: AdminUser) {
    try {
      await updateAdminUser(user.id, { is_disabled: !user.is_disabled });
      showToast(user.is_disabled ? `${user.display_name} can sign in again.` : `${user.display_name} was disabled and signed out.`, "success");
      load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't update that user.");
    }
  }

  async function twoFactorOff(user: AdminUser) {
    try {
      await switchOffTwoFactor(user.id);
      showToast(`Two-step sign-in is off for ${user.display_name}. They can turn it on again in Settings.`, "success");
      load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't switch that off.");
    }
  }

  const done = (message: string) => {
    setModal(null);
    showToast(message, "success");
    load();
  };

  if (error && !users) {
    return (
      <div role="alert" className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-200">
        {error}{" "}
        <button type="button" onClick={load} className="underline">
          Try again
        </button>
      </div>
    );
  }
  if (!users) return <p className="text-sm text-white/50">Loading users…</p>;

  const shown = applyFilter(users, filter);

  return (
    <section aria-label="Users" className="space-y-4">
      {onBack && (
        <div className="space-y-3">
          <button type="button" onClick={onBack} className={quietButton}>
            ← {backLabel}
          </button>
          <h2 className="text-xl font-semibold text-white">{filter ? FILTER_TITLES[filter] : "People"}</h2>
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-white/50">
          {shown.length} {shown.length === 1 ? "person" : "people"}
        </p>
        <button type="button" onClick={() => setModal({ kind: "create" })} className={primaryButton}>
          Add user
        </button>
      </div>
      {shown.length === 0 && <p className="text-sm text-white/40">Nobody here.</p>}

      <ul className="divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/[0.03]">
        {shown.map((user) => {
          const isMe = user.id === currentUserId;
          return (
            <li key={user.id} className="flex items-center gap-3 px-4 py-4">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Avatar name={user.display_name} src={user.avatar_url} size={44} />
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-white">
                    <span className="truncate">{user.display_name}</span>
                    {isMe && <span className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-white/60">You</span>}
                    {user.is_admin && <span className="rounded bg-accent/15 px-1.5 py-0.5 text-xs text-accent">Admin</span>}
                    {user.two_factor_enabled && <span title="Two-step sign-in is on" className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-xs text-emerald-300">2-step</span>}
                    {user.is_disabled && <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-xs text-red-300">Disabled</span>}
                  </p>
                  <p className="truncate text-xs text-white/40">
                    @{user.username} · last sign-in {formatDate(user.last_login_at)} · {user.watched_count} watched
                  </p>
                </div>
              </div>
              <ActionMenu
                label={`Actions for ${user.display_name}`}
                actions={[
                  ...(onView ? [{ label: "View", ariaLabel: `View ${user.display_name}`, onSelect: () => onView(user.id) }] : []),
                  { label: "Edit", ariaLabel: `Edit ${user.display_name}`, onSelect: () => setModal({ kind: "edit", user }) },
                  ...(isMe
                    ? []
                    : [
                        { label: "Reset password", ariaLabel: `Reset password for ${user.display_name}`, onSelect: () => setModal({ kind: "password", user }) },
                        ...(user.two_factor_enabled
                          ? [{ label: "Switch off 2-step", ariaLabel: `Switch off two-step sign-in for ${user.display_name}`, onSelect: () => twoFactorOff(user) }]
                          : []),
                        { label: user.is_disabled ? "Enable" : "Disable", ariaLabel: `${user.is_disabled ? "Enable" : "Disable"} ${user.display_name}`, onSelect: () => toggleDisabled(user) },
                        { label: "Delete", ariaLabel: `Delete ${user.display_name}`, onSelect: () => setModal({ kind: "delete", user }), danger: true },
                      ]),
                ]}
              />
            </li>
          );
        })}
      </ul>

      {modal?.kind === "create" && <CreateDialog onClose={() => setModal(null)} onDone={done} />}
      {modal?.kind === "edit" && <EditDialog user={modal.user} isMe={modal.user.id === currentUserId} onClose={() => setModal(null)} onDone={done} />}
      {modal?.kind === "password" && <PasswordDialog user={modal.user} onClose={() => setModal(null)} onDone={done} />}
      {modal?.kind === "delete" && <DeleteDialog user={modal.user} onClose={() => setModal(null)} onDone={done} />}
    </section>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm text-white/70">
      {label}
      {children}
      {hint && <span className="text-xs text-white/40">{hint}</span>}
    </label>
  );
}

function Actions({ onClose, submitLabel, busy, danger = false, disabled = false }: { onClose: () => void; submitLabel: string; busy: boolean; danger?: boolean; disabled?: boolean }) {
  return (
    <div className="mt-5 flex justify-end gap-2">
      <button type="button" onClick={onClose} className={quietButton}>
        Cancel
      </button>
      <button type="submit" disabled={busy || disabled} className={danger ? dangerButton : primaryButton}>
        {busy ? "Working…" : submitLabel}
      </button>
    </div>
  );
}

function ErrorLine({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="mt-3 text-sm text-red-400">
      {message}
    </p>
  ) : null;
}

function useSubmit(action: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }
  return { busy, error, submit };
}

function CreateDialog({ onClose, onDone }: { onClose: () => void; onDone: (m: string) => void }) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  // Admin is deliberately a detour: not a checkbox, and it has to be confirmed by typing a word.
  const [adminStep, setAdminStep] = useState<"off" | "confirm" | "on">("off");
  const [typed, setTyped] = useState("");
  const isAdmin = adminStep === "on";
  const { busy, error, submit } = useSubmit(async () => {
    const created = await createAdminUser({ username, display_name: displayName.trim(), password, is_admin: isAdmin });
    onDone(`${created.display_name} was added${created.is_admin ? " as an admin" : ""}.`);
  });
  return (
    <Dialog title="Add user" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Username" hint="Lowercase letters, numbers, . _ - (3–32 characters). They sign in with this.">
          <input data-autofocus value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoComplete="off" className={fieldClass} />
        </Field>
        <Field label="Display name">
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={50} className={fieldClass} />
        </Field>
        <Field label="Password" hint="At least 8 characters. They can change it later in Settings.">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" className={fieldClass} />
        </Field>

        {adminStep === "off" && (
          <button type="button" onClick={() => setAdminStep("confirm")} className="block text-xs text-white/30 underline-offset-2 hover:text-white/60 hover:underline">
            Create as an admin instead…
          </button>
        )}
        {adminStep === "confirm" && (
          <div role="group" aria-label="Confirm admin" className="space-y-3 rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm">
            <p className="font-medium text-red-200">Admins can see everyone&apos;s activity, change anything on the site and remove people.</p>
            <label className="flex flex-col gap-1.5 text-white/70">
              Type <span className="font-mono text-white">admin</span> to confirm
              <input aria-label="Type admin to confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="none" className={fieldClass} />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={typed.trim().toLowerCase() !== "admin"}
                onClick={() => setAdminStep("on")}
                className="h-9 rounded-lg bg-red-500/80 px-3 text-sm font-medium text-white disabled:opacity-40"
              >
                Yes, make them an admin
              </button>
              <button type="button" onClick={() => { setAdminStep("off"); setTyped(""); }} className={quietButton}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {adminStep === "on" && (
          <p className="flex items-center justify-between gap-3 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <span>This person will be an admin.</span>
            <button type="button" onClick={() => { setAdminStep("off"); setTyped(""); }} className="text-xs underline">
              Undo
            </button>
          </p>
        )}

        <ErrorLine message={error} />
        <Actions onClose={onClose} busy={busy} submitLabel={isAdmin ? "Add admin" : "Add user"} disabled={!username.trim() || !displayName.trim() || password.length < 8 || adminStep === "confirm"} />
      </form>
    </Dialog>
  );
}

function EditDialog({ user, isMe, onClose, onDone }: { user: AdminUser; isMe: boolean; onClose: () => void; onDone: (m: string) => void }) {
  const [username, setUsername] = useState(user.username);
  const [displayName, setDisplayName] = useState(user.display_name);
  const [isAdmin, setIsAdmin] = useState(user.is_admin);
  const { busy, error, submit } = useSubmit(async () => {
    const changes: Parameters<typeof updateAdminUser>[1] = {};
    if (username.trim() !== user.username) changes.username = username.trim();
    if (displayName.trim() !== user.display_name) changes.display_name = displayName.trim();
    if (isAdmin !== user.is_admin) changes.is_admin = isAdmin;
    if (Object.keys(changes).length === 0) return onClose();
    await updateAdminUser(user.id, changes);
    onDone("Saved.");
  });
  return (
    <Dialog title={`Edit ${user.display_name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Username" hint="Changing it changes what they type to sign in.">
          <input data-autofocus value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" className={fieldClass} />
        </Field>
        <Field label="Display name">
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={50} className={fieldClass} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-white/70">
          <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} className="h-4 w-4 accent-accent" />
          Admin{isMe && <span className="text-xs text-white/40"> (the server needs at least one active admin)</span>}
        </label>
        <ErrorLine message={error} />
        <Actions onClose={onClose} busy={busy} submitLabel="Save" disabled={!username.trim() || !displayName.trim()} />
      </form>
    </Dialog>
  );
}

function PasswordDialog({ user, onClose, onDone }: { user: AdminUser; onClose: () => void; onDone: (m: string) => void }) {
  const [password, setPassword] = useState("");
  const { busy, error, submit } = useSubmit(async () => {
    await resetAdminPassword(user.id, password);
    onDone(`${user.display_name}'s password was reset and they were signed out everywhere.`);
  });
  return (
    <Dialog title={`Reset password for ${user.display_name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="New password" hint="At least 8 characters. Tell them in person; they can change it in Settings.">
          <input data-autofocus type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" className={fieldClass} />
        </Field>
        <ErrorLine message={error} />
        <Actions onClose={onClose} busy={busy} submitLabel="Reset password" disabled={password.length < 8} />
      </form>
    </Dialog>
  );
}

function DeleteDialog({ user, onClose, onDone }: { user: AdminUser; onClose: () => void; onDone: (m: string) => void }) {
  const [typed, setTyped] = useState("");
  const { busy, error, submit } = useSubmit(async () => {
    await deleteAdminUser(user.id);
    onDone(`${user.display_name} was deleted.`);
  });
  return (
    <Dialog title={`Delete ${user.display_name}?`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="text-sm text-white/70">
          This permanently removes their account, {boxNameFor(user.display_name)}, watch history and settings. It can&apos;t be undone. To keep the account but stop
          them signing in, use <strong>Disable</strong> instead.
        </p>
        <div className="mt-4">
          <Field label={`Type ${user.username} to confirm`}>
            <input data-autofocus value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="none" autoComplete="off" className={fieldClass} />
          </Field>
        </div>
        <ErrorLine message={error} />
        <Actions onClose={onClose} busy={busy} submitLabel="Delete" danger disabled={typed.trim() !== user.username} />
      </form>
    </Dialog>
  );
}
