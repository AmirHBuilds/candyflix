import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import FadeImage from "@/components/FadeImage";

// jsdom never really loads images, so decide what `complete` says.
function setComplete(value: boolean) {
  vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(value);
}

afterEach(() => vi.restoreAllMocks());

const props = { src: "/poster.jpg", alt: "A poster", width: 100, height: 150, unoptimized: true } as const;

describe("FadeImage", () => {
  it("leaves an already-loaded (cached) image fully visible — nothing is hidden waiting on JS", () => {
    setComplete(true);
    render(<FadeImage {...props} />);
    const img = screen.getByAltText("A poster");
    expect(img).toHaveClass("opacity-100");
    expect(img).not.toHaveClass("opacity-0");
  });

  it("holds a still-loading image transparent, then fades it in when it loads", async () => {
    setComplete(false);
    render(<FadeImage {...props} />);
    const img = screen.getByAltText("A poster");
    expect(img).toHaveClass("opacity-0");

    fireEvent.load(img);

    // next/image reports the load after the browser has decoded the image.
    await waitFor(() => expect(img).toHaveClass("opacity-100"));
    expect(img).not.toHaveClass("opacity-0");
  });

  it("shows a broken image (its alt text) instead of leaving it invisible forever", () => {
    setComplete(false);
    render(<FadeImage {...props} />);
    const img = screen.getByAltText("A poster");
    expect(img).toHaveClass("opacity-0");

    fireEvent.error(img);

    expect(img).toHaveClass("opacity-100");
  });

  it("still calls the caller's own onLoad / onError and keeps its className", async () => {
    setComplete(false);
    const onLoad = vi.fn();
    const onError = vi.fn();
    render(<FadeImage {...props} className="object-cover" onLoad={onLoad} onError={onError} />);
    const img = screen.getByAltText("A poster");
    expect(img).toHaveClass("object-cover");

    fireEvent.load(img);
    fireEvent.error(img);

    await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(1));
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("fades opacity slowly but keeps the hover-zoom transform quick", () => {
    setComplete(true);
    render(<FadeImage {...props} />);
    expect(screen.getByAltText("A poster").className).toContain("opacity_0.5s");
    expect(screen.getByAltText("A poster").className).toContain("transform_0.2s");
  });
});
