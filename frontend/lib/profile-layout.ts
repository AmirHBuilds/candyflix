import type { UserPublic } from "@/lib/auth";

export type Tier = "king" | "admin" | "member";
export type Slot = { kind: "profile"; user: UserPublic; tier: Tier; index: number } | { kind: "spacer" };

/** How big each tier's picture is on the login screen. */
export const TIER_SIZE: Record<Tier, number> = { king: 104, admin: 92, member: 80 };

/**
 * Lays the "Who's watching?" row out left to right.
 *
 * The first admin (the oldest account) is the king and sits in the exact middle. Other admins
 * stand beside the king, then everyone else beyond them, and both sides always hold the same
 * number of people (a spacer fills the odd one out) so the king stays centred and the row
 * scrolls equally far both ways. Each side is built from the middle outwards: the next person
 * goes to whichever side has fewer (the left on a tie).
 */
export function layoutProfiles(users: UserPublic[]): Slot[] {
  const indexed = users.map((user, index) => ({ user, index }));
  const admins = indexed.filter((p) => p.user.is_admin);
  const members = indexed.filter((p) => !p.user.is_admin);
  const king = admins[0];

  type P = { kind: "profile"; user: UserPublic; tier: Tier; index: number };
  const left: P[] = [];
  const right: P[] = [];
  const place = (p: { user: UserPublic; index: number }, tier: Tier) => {
    (left.length <= right.length ? left : right).push({ kind: "profile", user: p.user, tier, index: p.index });
  };
  admins.slice(1).forEach((p) => place(p, "admin"));
  members.forEach((p) => place(p, "member"));

  // Spacer on the outer end of the shorter side keeps the middle in the middle.
  const leftOuter: Slot[] = [...left].reverse();
  const rightOuter: Slot[] = [...right];
  if (left.length < right.length) leftOuter.unshift({ kind: "spacer" });
  if (right.length < left.length) rightOuter.push({ kind: "spacer" });

  const middle: Slot[] = king ? [{ kind: "profile", user: king.user, tier: "king", index: king.index }] : [];
  return [...leftOuter, ...middle, ...rightOuter];
}
