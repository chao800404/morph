// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { keepImport } from "./keep-import";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("keepImport", () => {
  it("loads nothing until it is first called", () => {
    const load = vi.fn(async () => ({ value: 1 }));
    keepImport(load);
    expect(load).not.toHaveBeenCalled();
  });

  it("loads once and keeps the module for later calls", async () => {
    const module = { value: 1 };
    const load = vi.fn(async () => module);
    const get = keepImport(load);
    expect(await get()).toBe(module);
    expect(await get()).toBe(module);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("gives concurrent callers the same load", async () => {
    const pending = deferred<{ value: number }>();
    const load = vi.fn(() => pending.promise);
    const get = keepImport(load);
    const first = get();
    const second = get();
    expect(load).toHaveBeenCalledTimes(1);
    pending.resolve({ value: 2 });
    expect(await first).toBe(await second);
  });

  it("does not keep a failed load, so the next call tries again", async () => {
    const load = vi
      .fn<() => Promise<{ value: number }>>()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce({ value: 3 });
    const get = keepImport(load);
    await expect(get()).rejects.toThrow("unavailable");
    await expect(get()).resolves.toEqual({ value: 3 });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("fails every caller that shared the failed load, then recovers", async () => {
    const pending = deferred<{ value: number }>();
    const load = vi
      .fn<() => Promise<{ value: number }>>()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({ value: 4 });
    const get = keepImport(load);
    const first = get();
    const second = get();
    pending.reject(new Error("unavailable"));
    await expect(first).rejects.toThrow("unavailable");
    await expect(second).rejects.toThrow("unavailable");
    await expect(get()).resolves.toEqual({ value: 4 });
  });

  it("keeps the retry's load once an earlier load has failed", async () => {
    // A new load starts only after the failed one has cleared itself, so the
    // two never overlap; what matters is that the retry is the one kept.
    const older = deferred<{ value: number }>();
    const newer = deferred<{ value: number }>();
    const load = vi
      .fn<() => Promise<{ value: number }>>()
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise)
      .mockResolvedValue({ value: 99 });
    const get = keepImport(load);

    const first = get();
    older.reject(new Error("unavailable"));
    await expect(first).rejects.toThrow("unavailable");
    const second = get();
    newer.resolve({ value: 5 });
    await expect(second).resolves.toEqual({ value: 5 });

    // The newer load is the one kept; nothing loads again.
    await expect(get()).resolves.toEqual({ value: 5 });
    expect(load).toHaveBeenCalledTimes(2);
  });
});
