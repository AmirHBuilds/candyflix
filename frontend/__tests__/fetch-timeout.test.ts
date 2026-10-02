import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { FETCH_TIMEOUT_MS, RequestTimeoutError, fetchWithTimeout } from "@/lib/api-client";
import { getTrending } from "@/lib/media";

// A fetch that never answers, but — like the real one — rejects with an
// AbortError the moment its signal aborts.
function hangingFetch() {
  return vi.fn((_url: string, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      // Like the real fetch: an already-aborted signal rejects straight away.
      if (init?.signal?.aborted) {
        reject(init.signal.reason ?? new DOMException("Aborted", "AbortError"));
        return;
      }
      init?.signal?.addEventListener("abort", () => {
        reject(init.signal!.reason ?? new DOMException("Aborted", "AbortError"));
      });
    });
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("fetchWithTimeout", () => {
  it("returns the response untouched when the server answers in time, and leaves no timer behind", async () => {
    const response = new Response("ok");
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);

    const res = await fetchWithTimeout("http://x/api", { cache: "no-store", headers: { A: "b" } });

    expect(res).toBe(response);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://x/api",
      expect.objectContaining({ cache: "no-store", headers: { A: "b" }, signal: expect.any(AbortSignal) })
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects with a RequestTimeoutError instead of hanging forever", async () => {
    vi.stubGlobal("fetch", hangingFetch());

    const promise = fetchWithTimeout("http://x/api", {}, 5000);
    const assertion = expect(promise).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(5000);

    await assertion;
    await expect(promise).rejects.toThrow(/longer than 5s/);
  });

  it("waits the full timeout, not less", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    let settled = false;
    const promise = fetchWithTimeout("http://x/api", {}, 5000).catch(() => (settled = true));

    await vi.advanceTimersByTimeAsync(4999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await promise;
    expect(settled).toBe(true);
  });

  it("uses a 20 second default", async () => {
    expect(FETCH_TIMEOUT_MS).toBe(20_000);
    vi.stubGlobal("fetch", hangingFetch());
    const promise = fetchWithTimeout("http://x/api");
    const assertion = expect(promise).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(19_999);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
  });

  it("a caller's own abort still works and is reported as an abort, not a timeout", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const caller = new AbortController();

    const promise = fetchWithTimeout("http://x/api", { signal: caller.signal }, 5000);
    const assertion = expect(promise).rejects.toMatchObject({ name: "AbortError" });
    caller.abort();

    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("an already-aborted caller signal aborts immediately", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const caller = new AbortController();
    caller.abort();
    await expect(fetchWithTimeout("http://x/api", { signal: caller.signal }, 5000)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("non-timeout network errors pass through unchanged", async () => {
    const boom = new TypeError("fetch failed");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(boom));
    await expect(fetchWithTimeout("http://x/api")).rejects.toBe(boom);
  });
});

describe("a stalled backend can no longer leave a page waiting forever", () => {
  it("the data fetchers (here: getTrending) give up and throw after the timeout", async () => {
    vi.stubGlobal("fetch", hangingFetch());

    const promise = getTrending("day");
    const assertion = expect(promise).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS);

    await assertion;
  });
});
