"use client";

import { useEffect, useRef } from "react";
import AdminBadge from "@/components/AdminBadge";
import Avatar from "@/components/Avatar";
import type { UserPublic } from "@/lib/auth";
import { TIER_SIZE, layoutProfiles } from "@/lib/profile-layout";
import type { BadgeContent } from "@/lib/site";

/**
 * The "Who's watching?" row. The king (first admin) is in the middle, other admins beside them, a bit
 * smaller, everyone else beyond. A long row scrolls sideways (drag with the mouse, swipe on touch) and
 * starts with the king in view, with equal room to either side.
 */
export default function ProfilePicker({
  users,
  badge,
  colors,
  onPick,
}: {
  users: UserPublic[];
  badge: BadgeContent;
  colors: string[];
  onPick: (user: UserPublic) => void;
}) {
  const slots = layoutProfiles(users);
  const scroller = useRef<HTMLDivElement>(null);
  const kingRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ down: false, startX: 0, startLeft: 0, moved: false });
  const key = users.map((u) => u.id).join(",");

  // Centre the king (or the middle of the row) whenever the people change.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const king = kingRef.current;
    el.scrollLeft = king ? king.offsetLeft - (el.clientWidth - king.offsetWidth) / 2 : (el.scrollWidth - el.clientWidth) / 2;
  }, [key]);

  // Mouse dragging (touch and trackpads already scroll natively).
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = drag.current;
      if (!d.down || !scroller.current) return;
      const dx = e.clientX - d.startX;
      if (Math.abs(dx) > 5) d.moved = true;
      scroller.current.scrollLeft = d.startLeft - dx;
    };
    const up = () => {
      drag.current.down = false;
      if (scroller.current) scroller.current.style.cursor = "";
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  return (
    <div
      ref={scroller}
      data-testid="profile-row"
      onMouseDown={(e) => {
        if (e.button !== 0 || !scroller.current) return;
        drag.current = { down: true, startX: e.clientX, startLeft: scroller.current.scrollLeft, moved: false };
        scroller.current.style.cursor = "grabbing";
      }}
      // A drag must not count as a click on whoever the mouse ends up over.
      onClickCapture={(e) => {
        if (drag.current.moved) {
          e.preventDefault();
          e.stopPropagation();
          drag.current.moved = false;
        }
      }}
      className="w-full max-w-full cursor-grab select-none overflow-x-auto pb-3 pt-10 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <div className="mx-auto flex w-max items-end gap-6 px-10">
        {slots.map((slot, i) =>
          slot.kind === "spacer" ? (
            <div key={`spacer-${i}`} aria-hidden="true" style={{ width: TIER_SIZE.member }} className="shrink-0" />
          ) : (
            <div key={slot.user.id} ref={slot.tier === "king" ? kingRef : undefined} data-tier={slot.tier} className="shrink-0">
              <button type="button" onClick={() => onPick(slot.user)} className="group flex flex-col items-center gap-3" draggable={false}>
                <span className="relative block" style={{ width: TIER_SIZE[slot.tier], height: TIER_SIZE[slot.tier] }}>
                  <Avatar
                    name={slot.user.display_name}
                    src={slot.user.avatar_url}
                    size={TIER_SIZE[slot.tier]}
                    color={colors[slot.index % colors.length]}
                    className="pointer-events-none transition-transform duration-150 group-hover:scale-105"
                  />
                  {slot.user.is_admin && <AdminBadge badge={badge} size={TIER_SIZE[slot.tier]} />}
                </span>
                <span className={`max-w-[9rem] truncate ${slot.tier === "king" ? "text-base font-medium text-white" : "text-sm text-white/80"}`}>
                  {slot.user.display_name}
                </span>
              </button>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
