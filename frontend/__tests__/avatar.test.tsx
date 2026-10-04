import { describe, it, expect } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import Avatar from "@/components/Avatar";

describe("Avatar", () => {
  it("shows the initial when there is no picture", () => {
    render(<Avatar name="candy" />);
    expect(screen.getByText("C")).toBeInTheDocument();
  });

  it("uses the backend origin for the picture path", () => {
    const { container } = render(<Avatar name="Candy" src="/avatars/a.webp" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("http://localhost:8000/avatars/a.webp");
  });

  it("falls back to the initial when the picture fails to load", () => {
    const { container } = render(<Avatar name="Candy" src="/avatars/a.webp" />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("C")).toBeInTheDocument();
  });

  it("tries a new picture again after one failed", () => {
    const { container, rerender } = render(<Avatar name="Candy" src="/avatars/a.webp" />);
    fireEvent.error(container.querySelector("img")!);
    rerender(<Avatar name="Candy" src="/avatars/b.webp" />);
    expect(container.querySelector("img")).not.toBeNull();
    cleanup();
  });

  it("handles an empty name", () => {
    render(<Avatar name="  " />);
    expect(screen.getByText("?")).toBeInTheDocument();
  });
});
