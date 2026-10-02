// A tiny global toast store, so any client code can say "tell the person
// this didn't work" without threading a context through the tree:
//
//   import { showToast } from "@/lib/toast";
//   showToast("Couldn't update your Candy Box.");
//
// <Toaster /> (mounted once in the root layout) renders whatever is in
// here. Kept as a plain module store read through useSyncExternalStore.

export type ToastKind = "error" | "info" | "success";

export type Toast = { id: number; message: string; kind: ToastKind };

const MAX_VISIBLE = 3;
const DEFAULT_DURATION_MS = 4500;

let toasts: Toast[] = [];
let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current toasts. A new array on every change (and the same one between changes). */
export function getToasts(): Toast[] {
  return toasts;
}

export function dismissToast(id: number): void {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/**
 * Shows a message for a few seconds. Returns the toast's id.
 *
 * Showing the same message again while it's still up just restarts its
 * timer instead of stacking duplicates (e.g. someone tapping a failing
 * button repeatedly). At most three are shown; the oldest is dropped.
 */
export function showToast(
  message: string,
  kind: ToastKind = "error",
  durationMs: number = DEFAULT_DURATION_MS
): number {
  const existing = toasts.find((t) => t.message === message && t.kind === kind);
  const id = existing ? existing.id : nextId++;

  if (!existing) {
    toasts = [...toasts, { id, message, kind }].slice(-MAX_VISIBLE);
    // Anything pushed out of the list must not leave a live timer behind.
    for (const [timerId, timer] of timers) {
      if (!toasts.some((t) => t.id === timerId)) {
        clearTimeout(timer);
        timers.delete(timerId);
      }
    }
    emit();
  } else {
    clearTimeout(timers.get(id));
  }

  timers.set(
    id,
    setTimeout(() => dismissToast(id), durationMs)
  );
  return id;
}

/** Test helper: drops every toast and timer. */
export function clearAllToasts(): void {
  timers.forEach((t) => clearTimeout(t));
  timers.clear();
  toasts = [];
  emit();
}
