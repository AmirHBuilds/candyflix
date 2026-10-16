import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/admin", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin")>("@/lib/admin");
  return { ...actual, listErrors: vi.fn(), markError: vi.fn(), deleteError: vi.fn(), handleAllErrors: vi.fn(), clearHandledErrors: vi.fn(), getHostStatus: vi.fn() };
});
vi.mock("@/lib/toast", () => ({ showToast: vi.fn() }));

import ErrorsTab from "@/components/admin/ErrorsTab";
import HostCard, { formatBytes, formatDuration } from "@/components/admin/HostCard";
import CandyIcon from "@/components/CandyIcon";
import * as admin from "@/lib/admin";
import { reportClientError } from "@/lib/report-error";

const entry = (over = {}) => ({
  id: "e1", created_at: new Date().toISOString(), last_seen: new Date().toISOString(), count: 1, source: "ai", level: "error" as const,
  title: "Gemini rejected the request (403)", detail: "Traceback...\nboom", where: "ai_service", user_name: null, handled: false, ...over,
});
const page = (items = [entry()]) => ({ items, total: items.length, unhandled: items.length, last_24h: items.length, by_source: { ai: items.length } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(admin.listErrors).mockResolvedValue(page());
});

describe("Errors tab", () => {
  it("lists what went wrong with where it came from and the counter", async () => {
    vi.mocked(admin.listErrors).mockResolvedValue(page([entry({ count: 4 })]));
    render(<ErrorsTab />);
    expect(await screen.findByText("Gemini rejected the request (403)")).toBeInTheDocument();
    expect(screen.getByText("×4")).toBeInTheDocument();
    expect(screen.getAllByText("AI").length).toBeGreaterThan(0);
    expect(screen.getByText(/1 open/)).toBeInTheDocument();
  });

  it("shows the details on request", async () => {
    render(<ErrorsTab />);
    fireEvent.click(await screen.findByRole("button", { name: "Details" }));
    expect(screen.getByText(/Traceback/)).toBeInTheDocument();
  });

  it("filters by source and asks the server for it", async () => {
    render(<ErrorsTab />);
    await screen.findByText("Gemini rejected the request (403)");
    fireEvent.click(screen.getByRole("button", { name: /Video service/ }));
    await waitFor(() => expect(admin.listErrors).toHaveBeenLastCalledWith(expect.objectContaining({ source: "resolver" })));
  });

  it("marks one handled and everything handled", async () => {
    vi.mocked(admin.markError).mockResolvedValue(entry({ handled: true }));
    vi.mocked(admin.handleAllErrors).mockResolvedValue({ changed: 1 });
    render(<ErrorsTab />);
    fireEvent.click(await screen.findByRole("button", { name: "Mark handled" }));
    await waitFor(() => expect(admin.markError).toHaveBeenCalledWith("e1", true));
    fireEvent.click(screen.getByRole("button", { name: "Mark all handled" }));
    await waitFor(() => expect(admin.handleAllErrors).toHaveBeenCalled());
  });

  it("says so when the log is empty", async () => {
    vi.mocked(admin.listErrors).mockResolvedValue({ items: [], total: 0, unhandled: 0, last_24h: 0, by_source: {} });
    render(<ErrorsTab />);
    expect(await screen.findByText(/Nothing here/)).toBeInTheDocument();
  });
});

describe("Server card", () => {
  const host = {
    memory: { total: 8e9, available: 2e9, used: 6e9, swap_total: 0, swap_used: 0 },
    cpu: { cores: 2, load_1: 0.5, load_5: 0.4, load_15: 0.3 },
    uptime: { host_seconds: 90000, app_seconds: 3700, app_memory: 150e6 },
    disks: [{ label: "Server disk", path: "/", total: 100e9, used: 92e9, free: 8e9 }],
    folders: [{ label: "Sync audio and speech maps", files: 3, bytes: 5e6 }],
    database: { bytes: 12e6, connections: 4 },
    redis: { bytes: 2e6, keys: 40 },
    resolver: { ok: false, detail: "Can't reach it: ConnectError", latency_ms: null },
    watching_now: 2,
  };

  it("shows disk, memory and load as meters, and flags problems", async () => {
    vi.mocked(admin.getHostStatus).mockResolvedValue(host);
    render(<HostCard />);
    expect(await screen.findByRole("meter", { name: "Disk space: Server disk" })).toHaveAttribute("aria-valuenow", "92");
    expect(screen.getByRole("meter", { name: "Memory" })).toHaveAttribute("aria-valuenow", "75");
    expect(screen.getByRole("meter", { name: "Processor load" })).toHaveAttribute("aria-valuenow", "25");
    expect(screen.getByText("Not answering")).toBeInTheDocument();
    expect(screen.getByText("Watching right now")).toBeInTheDocument();
  });

  it("formats sizes and times", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 ** 3)).toBe("5.0 GB");
    expect(formatDuration(3700)).toBe("1h 1m");
    expect(formatDuration(90000)).toBe("1d 1h");
  });
});

describe("candy logo", () => {
  it("is a picture, not an emoji", () => {
    const { container } = render(<CandyIcon size={30} />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("width", "30");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(container.textContent).toBe("");
  });
});

describe("reporting a browser problem", () => {
  it("posts it once and never throws", () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    reportClientError("player", new Error("The video file is gone (HTTP 404)"));
    reportClientError("player", new Error("The video file is gone (HTTP 404)"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.kind).toBe("player");
    expect(body.message).toContain("gone");
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("offline"); }));
    expect(() => reportClientError("page", new Error("other"))).not.toThrow();
    vi.unstubAllGlobals();
  });
});
