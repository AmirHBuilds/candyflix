import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

import EmptyState from "@/components/EmptyState";
import ErrorState from "@/components/ErrorState";
import NotFoundState from "@/components/NotFoundState";
import MainError from "@/app/(main)/error";
import RootError from "@/app/error";
import MainNotFound from "@/app/(main)/not-found";
import RootNotFound from "@/app/not-found";

beforeEach(() => vi.clearAllMocks());

describe("EmptyState", () => {
  it("shows a title and message, with the decorative icon hidden from screen readers", () => {
    render(<EmptyState icon="box" title="Your Candy Box is empty" message="Nothing saved yet." />);
    expect(screen.getByRole("heading", { name: "Your Candy Box is empty" })).toBeInTheDocument();
    expect(screen.getByText("Nothing saved yet.")).toBeInTheDocument();
    expect(document.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("renders a link action that points where it says", () => {
    render(<EmptyState title="t" message="m" action={{ label: "Browse movies", href: "/movies" }} />);
    expect(screen.getByRole("link", { name: "Browse movies" })).toHaveAttribute("href", "/movies");
  });

  it("renders a button action that fires its callback", () => {
    const onClick = vi.fn();
    render(<EmptyState title="t" message="m" action={{ label: "Clear filters", onClick }} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("has no action button when none is given", () => {
    render(<EmptyState title="t" message="m" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("ErrorState", () => {
  it("is announced as an alert and shows the message", () => {
    render(<ErrorState message="Couldn't load movies." onRetry={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load movies.");
    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeInTheDocument();
  });

  it("'Try again' calls the caller's onRetry when one is given (no router needed)", () => {
    const onRetry = vi.fn();
    render(<ErrorState message="m" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("without onRetry, 'Try again' refreshes the route so server data reloads", () => {
    render(<ErrorState message="m" />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("retry={false} hides the button (for errors where retrying can't help)", () => {
    render(<ErrorState message="m" retry={false} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("can offer a secondary link and small-print detail", () => {
    render(
      <ErrorState
        message="m"
        onRetry={() => {}}
        secondary={{ label: "Back to details", href: "/movie/1" }}
        detail="Reference: abc123"
      />
    );
    expect(screen.getByRole("link", { name: "Back to details" })).toHaveAttribute("href", "/movie/1");
    expect(screen.getByText("Reference: abc123")).toBeInTheDocument();
  });
});

describe("error boundaries & not-found screens", () => {
  it("(main) error boundary: shows a friendly message, logs the error, 'Try again' calls reset", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const reset = vi.fn();
    const err = Object.assign(new Error("boom"), { digest: "d1g3st" });
    render(<MainError error={err} reset={reset} />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("boom")).not.toBeInTheDocument(); // never leak the raw error text
    expect(screen.getByText("Reference: d1g3st")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to home" })).toHaveAttribute("href", "/");
    expect(spy).toHaveBeenCalledWith(err);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("root error boundary behaves the same way", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const reset = vi.fn();
    render(<RootError error={new Error("kaboom")} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Reference:/)).not.toBeInTheDocument();
    spy.mockRestore();
  });

  it("not-found screens show the branded 404 with a way home", () => {
    for (const NotFound of [MainNotFound, RootNotFound, NotFoundState]) {
      const { unmount } = render(<NotFound />);
      expect(screen.getByText("404")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: /couldn't find that/i })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Back to home" })).toHaveAttribute("href", "/");
      unmount();
    }
  });
});
