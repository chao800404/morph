import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDebouncedWrites } from "./debounced-writes";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createDebouncedWrites", () => {
  it("runs a write once its delay ends, and only the newest per key", async () => {
    const writes = createDebouncedWrites();
    const older = vi.fn(async () => {});
    const newer = vi.fn(async () => {});

    writes.schedule("a", 300, older);
    writes.schedule("a", 300, newer);
    expect(writes.size).toBe(1);

    await vi.advanceTimersByTimeAsync(300);
    expect(older).not.toHaveBeenCalled();
    expect(newer).toHaveBeenCalledTimes(1);
    expect(writes.has("a")).toBe(false);
  });

  it("flushes the matching writes now and waits for them", async () => {
    const writes = createDebouncedWrites();
    let finish!: () => void;
    const slow = vi.fn(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    const other = vi.fn(async () => {});
    writes.schedule("theme:a", 300, slow);
    writes.schedule("other:b", 300, other);

    let flushed = false;
    void writes
      .flush((key) => key.startsWith("theme:"))
      .then(() => (flushed = true));
    await vi.advanceTimersByTimeAsync(0);

    expect(slow).toHaveBeenCalledTimes(1);
    expect(flushed).toBe(false);
    expect(writes.keys()).toEqual(["other:b"]);

    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(flushed).toBe(true);

    // A flushed write is not run again when its timer would have fired.
    await vi.advanceTimersByTimeAsync(300);
    expect(slow).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(1);
  });

  it("settles a flush even when a write rejects", async () => {
    const writes = createDebouncedWrites();
    writes.schedule("a", 300, () => Promise.reject(new Error("offline")));
    const ok = vi.fn(async () => {});
    writes.schedule("b", 300, ok);

    await expect(writes.flush()).resolves.toBeUndefined();
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it("cancels without running", async () => {
    const writes = createDebouncedWrites();
    const run = vi.fn(async () => {});
    writes.schedule("a", 300, run);

    expect(writes.cancel("a")).toBe(true);
    expect(writes.cancel("a")).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    expect(run).not.toHaveBeenCalled();
  });
});
