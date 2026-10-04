import { render } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

let path = "/a";
vi.mock("next/navigation", () => ({ usePathname: () => path }));
import ScrollToTop from "@/components/ScrollToTop";

describe("ScrollToTop", () => {
  beforeEach(() => {
    path = "/a";
    window.scrollTo = vi.fn() as never;
  });

  it("does nothing on first render", () => {
    render(<ScrollToTop />);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it("scrolls to the top when the path changes", () => {
    const { rerender } = render(<ScrollToTop />);
    path = "/movie/1";
    rerender(<ScrollToTop />);
    expect(window.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
  });

  it("leaves back/forward navigation to the browser", () => {
    const { rerender } = render(<ScrollToTop />);
    window.dispatchEvent(new PopStateEvent("popstate"));
    path = "/b";
    rerender(<ScrollToTop />);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});
