"use client";

import { useEffect, useRef, useState } from "react";
import AdminBadge from "@/components/AdminBadge";
import Avatar from "@/components/Avatar";
import { primaryButton, quietButton } from "@/components/admin/Dialog";
import { getAdminBadge, removeAdminBadgeImage, saveAdminBadgePosition, uploadAdminBadgeImage } from "@/lib/admin";
import type { BadgeContent, BadgePosition } from "@/lib/site";
import { showToast } from "@/lib/toast";

const SPOTS: { id: BadgePosition; label: string }[] = [
  { id: "top-left", label: "Top left" },
  { id: "top", label: "Top" },
  { id: "top-right", label: "Top right" },
];

export default function BadgeTab() {
  const [badge, setBadge] = useState<BadgeContent | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getAdminBadge().then(setBadge).catch((e) => setLoadError(e instanceof Error ? e.message : "Couldn't load the badge."));
  }, []);

  if (loadError) return <p role="alert" className="text-sm text-red-300">{loadError}</p>;
  if (!badge) return <p className="text-sm text-white/50">Loading…</p>;

  async function run(job: () => Promise<BadgeContent>, done: string) {
    setBusy(true);
    try {
      setBadge(await job());
      showToast(done, "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't save that.");
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <p className="text-sm text-white/50">
        Every admin wears this on the “Who’s watching?” screen. The first admin is the king and stands in the middle, a little larger; the other admins stand beside them.
      </p>

      <div className="flex flex-wrap items-center gap-8 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <div className="relative mt-8" style={{ width: 112, height: 112 }} aria-label="Preview">
          <Avatar name="Candy" size={112} />
          <AdminBadge badge={badge} size={112} />
        </div>
        <div className="space-y-4">
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-white/80">Where it sits</legend>
            <div className="flex flex-wrap gap-2">
              {SPOTS.map((s) => (
                <label
                  key={s.id}
                  className={`cursor-pointer rounded-xl px-4 py-2 text-sm font-medium ${badge.position === s.id ? "bg-accent text-on-accent" : "bg-white/5 text-white/70 hover:bg-white/10"}`}
                >
                  <input
                    type="radio"
                    name="badge-position"
                    className="sr-only"
                    checked={badge.position === s.id}
                    disabled={busy}
                    onChange={() => run(() => saveAdminBadgePosition(s.id), "Saved.")}
                  />
                  {s.label}
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <p className="mb-2 text-sm font-medium text-white/80">Picture</p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={file}
                type="file"
                accept="image/png,image/webp"
                aria-label="Badge picture"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void run(() => uploadAdminBadgeImage(f), "New badge saved.");
                }}
              />
              <button type="button" disabled={busy} onClick={() => file.current?.click()} className={primaryButton}>
                {badge.image_url ? "Choose another picture" : "Upload a picture"}
              </button>
              {badge.image_url && (
                <button type="button" disabled={busy} onClick={() => run(removeAdminBadgeImage, "Back to the crown.")} className={quietButton}>
                  Use the crown
                </button>
              )}
            </div>
            <p className="mt-2 text-xs text-white/40">
              A PNG with a transparent background works best (up to 2 MB). Draw it facing up, like a crown standing on a head; it leans on its own when placed top left or right.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
