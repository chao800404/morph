// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRemoveBackgroundImage } from "./remove-background-image";

afterEach(() => vi.unstubAllGlobals());
describe("bounded background-removal fetch", () => {
  it("uses the same-origin cookie without following redirects and bounds duration", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal("fetch", fetcher);
    expect(
      await fetchRemoveBackgroundImage(
        "https://cms.test/assets/a",
        "session=test",
      ),
    ).toEqual(new Uint8Array([1, 2, 3]));
    expect(fetcher).toHaveBeenCalledWith(
      "https://cms.test/assets/a",
      expect.objectContaining({
        headers: { cookie: "session=test" },
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    );
  });
  it.each([undefined, "1"])(
    "cancels an oversized chunked body despite Content-Length %s",
    async (length) => {
      const cancel = vi.fn();
      let reads = 0;
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            reads++;
            controller.enqueue(new Uint8Array(11 * 1024 * 1024));
          },
          cancel,
        },
        { highWaterMark: 0 },
      );
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response(body, {
              headers: length ? { "content-length": length } : undefined,
            }),
          ),
      );
      await expect(
        fetchRemoveBackgroundImage("https://cms.test/assets/a", null),
      ).rejects.toThrow("too large");
      expect(cancel).toHaveBeenCalledOnce();
      expect(reads).toBe(2);
    },
  );
  it("rejects declared oversize without reading it", async () => {
    const pull = vi.fn();
    const cancel = vi.fn();
    const body = new ReadableStream({ pull, cancel }, { highWaterMark: 0 });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(body, {
            headers: { "content-length": String(21 * 1024 * 1024) },
          }),
        ),
    );
    await expect(
      fetchRemoveBackgroundImage("https://cms.test/assets/a", null),
    ).rejects.toThrow("too large");
    expect(pull).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("propagates a timed-out body rather than returning partial bytes", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.error(new DOMException("Timed out", "TimeoutError"));
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    await expect(
      fetchRemoveBackgroundImage("https://cms.test/assets/a", null),
    ).rejects.toThrow("Timed out");
  });
});
