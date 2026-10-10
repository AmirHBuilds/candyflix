import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotAllowedError, getMovie, getTrending } from "@/lib/media";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("media requests", () => {
  it("send the session cookie, and let a server caller pass its own", async () => {
    fetchMock.mockImplementation(async () => new Response("[]", { status: 200 }));
    await getTrending("day");
    expect(fetchMock.mock.calls[0][1].credentials).toBe("include");
    await getTrending("day", { headers: { Cookie: "candyflix_session=abc" } });
    expect(fetchMock.mock.calls[1][1].headers).toEqual({ Cookie: "candyflix_session=abc" });
  });

  it("a 403 means the age limit rules the title out, not 'not found'", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ detail: "x" }), { status: 403 }));
    const err = await getMovie(5).catch((e) => e);
    expect(err).toBeInstanceOf(NotAllowedError);
    expect(err.message).toMatch(/isn't available for your account/);
  });
});
