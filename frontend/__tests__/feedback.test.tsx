import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import FeedbackForm from "@/components/settings/FeedbackForm";
import FeedbackTab from "@/components/admin/FeedbackTab";
import * as admin from "@/lib/admin";
import * as fb from "@/lib/feedback";

vi.mock("@/lib/feedback", async () => {
  const actual = await vi.importActual<typeof fb>("@/lib/feedback");
  return { ...actual, sendFeedback: vi.fn() };
});
vi.mock("@/lib/admin", async () => {
  const actual = await vi.importActual<typeof admin>("@/lib/admin");
  return { ...actual, listFeedback: vi.fn(), markFeedback: vi.fn(), deleteFeedback: vi.fn() };
});

const row = (over: Partial<admin.AdminFeedback> = {}): admin.AdminFeedback => ({
  id: "f1", kind: "problem", message: "Subtitles are early", page: "/watch/movie/1", device: "Chrome on Windows",
  created_at: new Date().toISOString(), handled: false, author_id: "u1", author_name: "Candy", ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(admin.listFeedback).mockResolvedValue({ items: [row()], total: 1, unhandled: 1 });
  vi.mocked(admin.markFeedback).mockResolvedValue(undefined);
  vi.mocked(admin.deleteFeedback).mockResolvedValue(undefined);
});

describe("Settings → Send us feedback", () => {
  it("sends the kind, the message and the page, then clears the box", async () => {
    vi.mocked(fb.sendFeedback).mockResolvedValue(undefined);
    render(<FeedbackForm />);
    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "A problem" }));
    fireEvent.change(screen.getByLabelText("Your feedback"), { target: { value: "  It froze  " } });
    fireEvent.click(send);
    await waitFor(() => expect(fb.sendFeedback).toHaveBeenCalledWith("problem", "It froze", expect.any(String)));
    expect(await screen.findByText("Sent. Thank you!")).toBeInTheDocument();
    expect(screen.getByLabelText("Your feedback")).toHaveValue("");
  });

  it("shows why it failed and keeps the text", async () => {
    vi.mocked(fb.sendFeedback).mockRejectedValue(new Error("That's plenty for today. Try again tomorrow."));
    render(<FeedbackForm />);
    fireEvent.change(screen.getByLabelText("Your feedback"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("plenty for today");
    expect(screen.getByLabelText("Your feedback")).toHaveValue("Hello");
  });
});

describe("Admin → Feedback", () => {
  it("lists what people wrote, marks it handled and deletes after a second click", async () => {
    render(<FeedbackTab />);
    expect(await screen.findByText("Subtitles are early")).toBeInTheDocument();
    expect(screen.getByText("Candy")).toBeInTheDocument();
    expect(screen.getByText("Problem")).toBeInTheDocument();
    expect(screen.getByText(/on \/watch\/movie\/1 · Chrome on Windows/)).toBeInTheDocument();
    expect(admin.listFeedback).toHaveBeenCalledWith(0, false);

    fireEvent.click(screen.getByRole("button", { name: "Mark handled" }));
    await waitFor(() => expect(admin.markFeedback).toHaveBeenCalledWith("f1", true));

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(admin.deleteFeedback).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Really delete?" }));
    await waitFor(() => expect(admin.deleteFeedback).toHaveBeenCalledWith("f1"));
  });

  it("can show everything", async () => {
    render(<FeedbackTab />);
    await screen.findByText("Subtitles are early");
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    await waitFor(() => expect(admin.listFeedback).toHaveBeenLastCalledWith(0, undefined));
  });
});
