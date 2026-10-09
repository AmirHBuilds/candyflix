import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminBadge from "@/components/AdminBadge";
import ProfilePicker from "@/components/ProfilePicker";
import BadgeTab from "@/components/admin/BadgeTab";
import * as admin from "@/lib/admin";
import type { UserPublic } from "@/lib/auth";
import { layoutProfiles, TIER_SIZE } from "@/lib/profile-layout";
import { DEFAULT_BADGE } from "@/lib/site";

vi.mock("@/lib/admin", async (orig) => ({ ...(await orig<typeof import("@/lib/admin")>()), getAdminBadge: vi.fn(), saveAdminBadgePosition: vi.fn(), uploadAdminBadgeImage: vi.fn(), removeAdminBadgeImage: vi.fn() }));
vi.mock("@/lib/toast", () => ({ showToast: vi.fn() }));

afterEach(cleanup);

const person = (name: string, is_admin = false): UserPublic => ({ id: name, username: name.toLowerCase(), display_name: name, created_at: "2026-01-01T00:00:00Z", avatar_url: null, is_admin });
const names = (users: UserPublic[]) => layoutProfiles(users).map((s) => (s.kind === "spacer" ? "·" : s.user.display_name));

describe("layoutProfiles", () => {
  it("puts the first admin in the middle with the same number of people on each side", () => {
    // Candy (king), Sam + Ann (admins), then five others
    const users = [person("Candy", true), person("Sam", true), person("Ann", true), ...["A", "B", "C", "D", "E"].map((n) => person(n))];
    const row = names(users);
    const k = row.indexOf("Candy");
    expect(row.slice(0, k).length).toBe(row.slice(k + 1).length);
    // the other admins stand right beside the king, one each side
    expect([row[k - 1], row[k + 1]].sort()).toEqual(["Ann", "Sam"]);
  });

  it("fills the odd one out with a spacer so the king stays centred", () => {
    const row = names([person("Candy", true), person("A"), person("B"), person("C")]);
    expect(row.filter((n) => n === "·")).toHaveLength(1);
    expect(row.indexOf("Candy")).toBe((row.length - 1) / 2);
  });

  it("works with one person, with no admin, and with several admins only", () => {
    expect(names([person("Candy", true)])).toEqual(["Candy"]);
    const none = names([person("A"), person("B"), person("C")]);
    expect(none.filter((n) => n !== "·").sort()).toEqual(["A", "B", "C"]);
    expect(names([person("Candy", true), person("Sam", true)])).toEqual(["Sam", "Candy", "·"]);
    const row = names([person("Candy", true), person("Sam", true), person("Ann", true)]);
    expect(row[1]).toBe("Candy");
  });

  it("sizes: king biggest, other admins next, everyone else smallest", () => {
    expect(TIER_SIZE.king).toBeGreaterThan(TIER_SIZE.admin);
    expect(TIER_SIZE.admin).toBeGreaterThan(TIER_SIZE.member);
    const tiers = layoutProfiles([person("Candy", true), person("Sam", true), person("A")]).flatMap((s) => (s.kind === "profile" ? [[s.user.display_name, s.tier]] : []));
    expect(Object.fromEntries(tiers)).toEqual({ Candy: "king", Sam: "admin", A: "member" });
  });
});

describe("ProfilePicker", () => {
  const users = [person("Candy", true), person("Sam", true), person("A"), person("B"), person("C")];

  it("shows a crown only on admins, in the chosen spot, and the king is larger", () => {
    const { container } = render(<ProfilePicker users={users} badge={{ position: "top-right", image_url: null }} colors={["#f0f"]} onPick={() => {}} />);
    const badges = container.querySelectorAll("[data-badge]");
    expect(badges).toHaveLength(2);
    expect(badges[0]).toHaveAttribute("data-badge", "top-right");
    const king = container.querySelector('[data-tier="king"]')!;
    const member = container.querySelector('[data-tier="member"]')!;
    expect(within(king as HTMLElement).getByRole("button", { name: /Candy/ })).toBeInTheDocument();
    expect((king.querySelector("span.relative") as HTMLElement).style.width).toBe(`${TIER_SIZE.king}px`);
    expect((member.querySelector("span.relative") as HTMLElement).style.width).toBe(`${TIER_SIZE.member}px`);
  });

  it("picks a person on click, but not at the end of a drag", async () => {
    const onPick = vi.fn();
    render(<ProfilePicker users={users} badge={DEFAULT_BADGE} colors={["#f0f"]} onPick={onPick} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /Candy/ }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ display_name: "Candy" }));

    onPick.mockClear();
    const row = screen.getByTestId("profile-row");
    fireEvent.mouseDown(row, { button: 0, clientX: 300 });
    fireEvent.mouseMove(window, { clientX: 200 });
    fireEvent.mouseUp(window);
    fireEvent.click(screen.getByRole("button", { name: /Sam/ }));
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Sam/ }));
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("uses the uploaded picture instead of the crown", () => {
    const { container } = render(<div className="relative"><AdminBadge badge={{ position: "top", image_url: "/avatars/badge-1.png" }} size={80} /></div>);
    expect(container.querySelector("img")?.getAttribute("src")).toMatch(/\/avatars\/badge-1\.png$/);
    expect(container.querySelector("svg")).toBeNull();
  });
});

describe("admin Badge tab", () => {
  beforeEach(() => {
    vi.mocked(admin.getAdminBadge).mockReset().mockResolvedValue(DEFAULT_BADGE);
    vi.mocked(admin.saveAdminBadgePosition).mockReset().mockImplementation(async (position) => ({ position, image_url: null }));
    vi.mocked(admin.uploadAdminBadgeImage).mockReset().mockResolvedValue({ position: "top-left", image_url: "/avatars/badge-9.png" });
    vi.mocked(admin.removeAdminBadgeImage).mockReset().mockResolvedValue(DEFAULT_BADGE);
  });

  it("changes the spot, uploads a picture and goes back to the crown", async () => {
    const user = userEvent.setup();
    render(<BadgeTab />);
    await user.click(await screen.findByLabelText("Top right"));
    await waitFor(() => expect(admin.saveAdminBadgePosition).toHaveBeenCalledWith("top-right"));
    expect(document.querySelector("[data-badge]")).toHaveAttribute("data-badge", "top-right");

    expect(screen.queryByRole("button", { name: "Use the crown" })).toBeNull();
    const file = new File([new Uint8Array([1, 2, 3])], "crown.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Badge picture"), file);
    await waitFor(() => expect(admin.uploadAdminBadgeImage).toHaveBeenCalledWith(file));
    await user.click(await screen.findByRole("button", { name: "Use the crown" }));
    await waitFor(() => expect(admin.removeAdminBadgeImage).toHaveBeenCalled());
  });
});
