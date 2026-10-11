import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import OpinionsTab from "@/components/admin/OpinionsTab";
import * as admin from "@/lib/admin";
import * as lib from "@/lib/opinions";

vi.mock("@/lib/admin", async () => {
  const actual = await vi.importActual<typeof admin>("@/lib/admin");
  return { ...actual, getSocialConfig: vi.fn(), saveSocialConfig: vi.fn(), listAdminOpinions: vi.fn(), hideAdminOpinion: vi.fn(), deleteAdminOpinion: vi.fn() };
});
vi.mock("@/lib/opinions", async () => {
  const actual = await vi.importActual<typeof lib>("@/lib/opinions");
  return { ...actual, getTitleOpinions: vi.fn() };
});

const row = (over: Partial<admin.AdminOpinion> = {}): admin.AdminOpinion => ({
  id: "o1", body: "rude comment", created_at: new Date().toISOString(), author_id: "u1", author_name: "Mom", is_anonymous: true,
  hidden: false, is_reply: false, media_type: "tv", tmdb_id: 5, season_number: 1, episode_number: 2, title: "Show", likes: 2, ...over,
});
const config = { enabled: true, allow_anonymous: true, allow_replies: true, home_section: true };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(admin.getSocialConfig).mockResolvedValue(config);
  vi.mocked(admin.listAdminOpinions).mockResolvedValue({ items: [row()], total: 1 });
});

describe("Admin → Opinions", () => {
  it("shows the real author of anonymous opinions and where they were written", async () => {
    render(<OpinionsTab />);
    expect(await screen.findByText("rude comment")).toBeInTheDocument();
    expect(screen.getByText("Mom")).toBeInTheDocument();
    expect(screen.getByText("posted anonymously")).toBeInTheDocument();
    expect(screen.getByText(/S1:E2/)).toBeInTheDocument();
  });

  it("flips a site switch and saves it", async () => {
    vi.mocked(admin.saveSocialConfig).mockResolvedValue({ ...config, allow_anonymous: false });
    render(<OpinionsTab />);
    await screen.findByText("rude comment");
    await waitFor(() => expect(screen.getByRole("switch", { name: "Anonymous posting" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("switch", { name: "Anonymous posting" }));
    await waitFor(() => expect(admin.saveSocialConfig).toHaveBeenCalledWith({ ...config, allow_anonymous: false }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Anonymous posting" })).toHaveAttribute("aria-checked", "false"));
  });

  it("hides an opinion and reloads", async () => {
    vi.mocked(admin.hideAdminOpinion).mockResolvedValue();
    render(<OpinionsTab />);
    fireEvent.click(await screen.findByRole("button", { name: "Hide" }));
    await waitFor(() => expect(admin.hideAdminOpinion).toHaveBeenCalledWith("o1", true));
    await waitFor(() => expect(admin.listAdminOpinions).toHaveBeenCalledTimes(2));
  });

  it("asks twice before deleting", async () => {
    vi.mocked(admin.deleteAdminOpinion).mockResolvedValue();
    render(<OpinionsTab />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(admin.deleteAdminOpinion).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Really delete?" }));
    await waitFor(() => expect(admin.deleteAdminOpinion).toHaveBeenCalledWith("o1"));
  });

  it("can list only hidden ones", async () => {
    render(<OpinionsTab />);
    await screen.findByText("rude comment");
    fireEvent.click(screen.getByLabelText("Only hidden"));
    await waitFor(() => expect(admin.listAdminOpinions).toHaveBeenLastCalledWith(0, true));
  });
});
