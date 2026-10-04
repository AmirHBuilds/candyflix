"use client";

import { useCallback, useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import Dialog, { dangerButton, fieldClass, primaryButton, quietButton } from "@/components/admin/Dialog";
import {
  createAdminUser,
  deleteAdminUser,
  listAdminUsers,
  resetAdminPassword,
  updateAdminUser,
  type AdminUser,
} from "@/lib/admin";
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

export default function UsersTab({ currentUserId }: { currentUserId: string }) {
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

  return (
    <section aria-label="Users" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-white/50">
          {users.length} {users.length === 1 ? "person" : "people"}
        </p>
        <button type="button" onClick={() => setModal({ kind: "create" })} className={primaryButton}>
          Add user
        </button>
      </div>

      <ul className="divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/[0.03]">
        {users.map((user) => {
          const isMe = user.id === currentUserId;
          return (
            <li key={user.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Avatar name={user.display_name} src={user.avatar_url} size={44} />
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-white">
                    <span className="truncate">{user.display_name}</span>
                    {isMe && <span className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-white/60">You</span>}
                    {user.is_admin && <span className="rounded bg-accent/15 px-1.5 py-0.5 text-xs text-accent">Admin</span>}
                    {user.is_disabled && <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-xs text-red-300">Disabled</span>}
                  </p>
                  <p className="truncate text-xs text-white/40">
                    @{user.username} · last sign-in {formatDate(user.last_login_at)} · {user.watchlist_count} in Candy Box · {user.watched_count} watched
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setModal({ kind: "edit", user })} className={quietButton} aria-label={`Edit ${user.display_name}`}>
                  Edit
                </button>
                {!isMe && (
                  <>
                    <button type="button" onClick={() => setModal({ kind: "password", user })} className={quietButton} aria-label={`Reset password for ${user.display_name}`}>
                      Reset password
                    </button>
                    <button type="button" onClick={() => toggleDisabled(user)} className={quietButton} aria-label={`${user.is_disabled ? "Enable" : "Disable"} ${user.display_name}`}>
                      {user.is_disabled ? "Enable" : "Disable"}
                    </button>
                    <button type="button" onClick={() => setModal({ kind: "delete", user })} className={`${quietButton} text-red-300`} aria-label={`Delete ${user.display_name}`}>
                      Delete
                    </button>
                  </>
                )}
              </div>
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
  const [isAdmin, setIsAdmin] = useState(false);
  const { busy, error, submit } = useSubmit(async () => {
    const created = await createAdminUser({ username, display_name: displayName.trim(), password, is_admin: isAdmin });
    onDone(`${created.display_name} was added.`);
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
        <label className="flex items-center gap-2 text-sm text-white/70">
          <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} className="h-4 w-4 accent-accent" />
          Make this person an admin
        </label>
        <ErrorLine message={error} />
        <Actions onClose={onClose} busy={busy} submitLabel="Add user" disabled={!username.trim() || !displayName.trim() || password.length < 8} />
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
          This permanently removes their account, Candy Box, watch history and settings. It can&apos;t be undone. To keep the account but stop
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
