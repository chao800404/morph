// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { onceInBrowser } from "./once-in-browser";

describe("onceInBrowser", () => {
  it("loads once in the browser, however often it is asked", async () => {
    const load = vi.fn(async () => "https://morph.test");
    const get = onceInBrowser(load, () => true);
    await expect(get()).resolves.toBe("https://morph.test");
    await expect(get()).resolves.toBe("https://morph.test");
    await Promise.all([get(), get()]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("loads on every call on the server, where requests differ", async () => {
    let n = 0;
    const load = vi.fn(async () => `https://host-${(n += 1)}.test`);
    const get = onceInBrowser(load, () => false);
    await expect(get()).resolves.toBe("https://host-1.test");
    await expect(get()).resolves.toBe("https://host-2.test");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not keep a failure: the next call tries again", async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce("https://morph.test");
    const get = onceInBrowser(load, () => true);
    await expect(get()).rejects.toThrow("offline");
    await expect(get()).resolves.toBe("https://morph.test");
    await expect(get()).resolves.toBe("https://morph.test");
    expect(load).toHaveBeenCalledTimes(2);
  });
});
