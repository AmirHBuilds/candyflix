"use client";

import { useCallback, useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import Dialog, { dangerButton, fieldClass, primaryButton, quietButton } from "@/components/admin/Dialog";
import {
  createAnnouncement,
  deleteAnnouncement,
  getAnnouncement,
  getAnnouncementTargets,
  listAdminUsers,
  listAnnouncements,
  reshowAnnouncement,
  updateAnnouncement,
  type AdminUser,
  type Announcement,
  type AnnouncementDetail,
  type AnnouncementInput,
  type AnnouncementStatus,
} from "@/lib/admin";
import { showToast } from "@/lib/toast";

const STATUS: Record<AnnouncementStatus, { label: string; cls: string }> = {
  active: { label: "Showing", cls: "bg-emerald-500/15 text-emerald-300" },
  expired: { label: "Ended", cls: "bg-white/10 text-white/50" },
  stopped: { label: "Stopped", cls: "bg-amber-500/15 text-amber-300" },
};

function when(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** ISO -> the value a <input type="datetime-local"> wants (local time). */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function StatusBadge({ status }: { status: AnnouncementStatus }) {
  return <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS[status].cls}`}>{STATUS[status].label}</span>;
}

function Meter({ accepted, recipients }: { accepted: number; recipients: number }) {
  const pct = recipients > 0 ? (accepted / recipients) * 100 : 0;
  return (
    <div className="min-w-[8rem]">
      <p className="text-xs text-white/60">
        {accepted} of {recipients} understood
      </p>
      <div className="mt-1 h-1 overflow-hidden rounded bg-white/10" aria-hidden="true">
        <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ---------------- compose / edit ----------------

function ComposeDialog({
  existing,
  onClose,
  onDone,
}: {
  existing?: AnnouncementDetail;
  onClose: () => void;
  onDone: (a: Announcement) => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? "");
  const [body, setBody] = useState(existing?.body ?? "");
  const [audience, setAudience] = useState<"all" | "selected">(existing?.audience ?? "all");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [people, setPeople] = useState<AdminUser[] | null>(null);
  const [expires, setExpires] = useState(toLocalInput(existing?.expires_at ?? null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listAdminUsers()
      .then(setPeople)
      .catch(() => setError("Couldn't load the people list."));
    if (existing?.audience === "selected") {
      getAnnouncementTargets(existing.id)
        .then((ids) => setChosen(new Set(ids)))
        .catch(() => {});
    }
  }, [existing]);

  const toggle = (id: string) =>
    setChosen((cur) => {
      const next = new Set(cur);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const valid = title.trim() && body.trim() && (audience === "all" || chosen.size > 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const input: AnnouncementInput = {
      title: title.trim(),
      body: body.trim(),
      audience,
      user_ids: audience === "selected" ? Array.from(chosen) : [],
      expires_at: expires ? new Date(expires).toISOString() : null,
    };
    try {
      onDone(existing ? await updateAnnouncement(existing.id, input) : await createAnnouncement(input));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <Dialog title={existing ? "Edit message" : "New message"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <label className="flex flex-col gap-1.5 text-sm text-white/70">
          Title
          <input data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-white/70">
          Message
          <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} rows={5} className={fieldClass} />
          <span className="text-xs text-white/40">{body.length}/2000</span>
        </label>
        <fieldset className="space-y-2 text-sm text-white/70">
          <legend className="mb-1">Who is it for?</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="audience" checked={audience === "all"} onChange={() => setAudience("all")} className="accent-accent" />
            Everyone (including people added later)
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="audience" checked={audience === "selected"} onChange={() => setAudience("selected")} className="accent-accent" />
            Only people I choose
          </label>
        </fieldset>
        {audience === "selected" && (
          <ul aria-label="People" className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-white/10 p-2">
            {!people ? (
              <li className="px-2 py-1 text-sm text-white/40">Loading…</li>
            ) : (
              people.map((p) => (
                <li key={p.id}>
                  <label className="flex items-center gap-2 rounded px-2 py-1 text-sm text-white/80 hover:bg-white/5">
                    <input type="checkbox" checked={chosen.has(p.id)} onChange={() => toggle(p.id)} className="h-4 w-4 accent-accent" />
                    {p.display_name} <span className="text-white/40">@{p.username}</span>
                  </label>
                </li>
              ))
            )}
          </ul>
        )}
        <label className="flex flex-col gap-1.5 text-sm text-white/70">
          Stop showing it on (optional)
          <input type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} className={fieldClass} />
          <span className="text-xs text-white/40">Leave empty to keep it until everyone presses “I understand”, or until you stop it.</span>
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={quietButton}>
            Cancel
          </button>
          <button type="submit" disabled={busy || !valid} className={primaryButton}>
            {busy ? "Saving…" : existing ? "Save" : "Send"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------- one message ----------------

function MessageDetail({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<AnnouncementDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    try {
      setDetail(await getAnnouncement(id));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load that message.");
    }
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000); // acceptances appear as people press the button
    return () => clearInterval(t);
  }, [load]);

  async function run(action: () => Promise<unknown>, success: string) {
    try {
      await action();
      showToast(success, "success");
      onChanged();
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  if (error && !detail) {
    return (
      <p role="alert" className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-200">
        {error}
      </p>
    );
  }
  if (!detail) return <p className="text-sm text-white/50">Loading…</p>;
  const waiting = detail.people.filter((p) => !p.acked_at);

  return (
    <section aria-label="Message" className="space-y-5">
      <button type="button" onClick={onBack} className={quietButton}>
        ← Messages
      </button>
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-white">{detail.title}</h2>
          <StatusBadge status={detail.status} />
        </div>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm text-white/80">{detail.body}</p>
        <p className="mt-3 text-xs text-white/40">
          Sent {when(detail.created_at)}
          {detail.created_by_name ? ` by ${detail.created_by_name}` : ""} · for {detail.audience === "all" ? "everyone" : `${detail.recipients} chosen ${detail.recipients === 1 ? "person" : "people"}`} ·{" "}
          {detail.expires_at ? `ends ${when(detail.expires_at)}` : "no end time"}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" className={quietButton} onClick={() => setEditing(true)}>
            Edit
          </button>
          {detail.is_active ? (
            <button type="button" className={quietButton} onClick={() => run(() => updateAnnouncement(id, { is_active: false }), "It's no longer shown.")}>
              Stop showing
            </button>
          ) : (
            <button type="button" className={quietButton} onClick={() => run(() => updateAnnouncement(id, { is_active: true }), "It's showing again.")}>
              Show again
            </button>
          )}
          <button
            type="button"
            className={quietButton}
            disabled={detail.accepted === 0}
            onClick={() => run(() => reshowAnnouncement(id), "Everyone will see it again.")}
          >
            Ask everyone again
          </button>
          {confirmDelete ? (
            <>
              <button
                type="button"
                className={dangerButton}
                onClick={async () => {
                  try {
                    await deleteAnnouncement(id);
                    showToast("Message deleted.", "success");
                    onChanged();
                    onBack();
                  } catch (err) {
                    showToast(err instanceof Error ? err.message : "Couldn't delete that message.");
                  }
                }}
              >
                Yes, delete it
              </button>
              <button type="button" className={quietButton} onClick={() => setConfirmDelete(false)}>
                Keep
              </button>
            </>
          ) : (
            <button type="button" className={`${quietButton} text-red-300`} onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-white">Who understood</h3>
          <Meter accepted={detail.accepted} recipients={detail.recipients} />
        </div>
        {detail.people.length === 0 ? (
          <p className="text-sm text-white/40">Nobody is on the list.</p>
        ) : (
          <ul className="divide-y divide-white/10">
            {detail.people.map((p) => (
              <li key={p.user_id} className="flex items-center gap-3 py-2.5 text-sm">
                <Avatar name={p.display_name} src={p.avatar_url} size={32} />
                <span className="min-w-0 flex-1 truncate text-white/90">
                  {p.display_name} <span className="text-white/40">@{p.username}</span>
                </span>
                {p.acked_at ? (
                  <time dateTime={p.acked_at} className="shrink-0 text-xs text-emerald-300">
                    Understood {when(p.acked_at)}
                  </time>
                ) : (
                  <span className="shrink-0 text-xs text-white/40">Not yet</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {waiting.length > 0 && detail.accepted > 0 && (
          <p className="mt-3 text-xs text-white/40">{waiting.length} still to read it.</p>
        )}
      </div>

      {editing && (
        <ComposeDialog
          existing={detail}
          onClose={() => setEditing(false)}
          onDone={() => {
            setEditing(false);
            showToast("Saved.", "success");
            onChanged();
            load();
          }}
        />
      )}
    </section>
  );
}

// ---------------- the tab ----------------

export default function MessagesTab() {
  const [items, setItems] = useState<Announcement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await listAnnouncements());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the messages.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (openId) return <MessageDetail id={openId} onBack={() => setOpenId(null)} onChanged={load} />;

  if (error && !items) {
    return (
      <div role="alert" className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-200">
        {error}{" "}
        <button type="button" onClick={load} className="underline">
          Try again
        </button>
      </div>
    );
  }
  if (!items) return <p className="text-sm text-white/50">Loading messages…</p>;

  return (
    <section aria-label="Messages" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-white/50">Shown at the top of the site until each person presses “I understand”.</p>
        <button type="button" onClick={() => setComposing(true)} className={primaryButton}>
          New message
        </button>
      </div>
      {items.length === 0 ? (
        <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-white/40">No messages yet.</p>
      ) : (
        <ul className="divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/[0.03]">
          {items.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => setOpenId(a.id)} className="flex w-full flex-col gap-3 px-4 py-4 text-left hover:bg-white/5 sm:flex-row sm:items-center">
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-white">
                    <span className="truncate">{a.title}</span>
                    <StatusBadge status={a.status} />
                  </span>
                  <span className="block truncate text-xs text-white/40">
                    {a.audience === "all" ? "Everyone" : "Chosen people"} · sent {when(a.created_at)}
                  </span>
                </span>
                <Meter accepted={a.accepted} recipients={a.recipients} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {composing && (
        <ComposeDialog
          onClose={() => setComposing(false)}
          onDone={(a) => {
            setComposing(false);
            showToast("Message sent.", "success");
            load();
            setOpenId(a.id);
          }}
        />
      )}
    </section>
  );
}
