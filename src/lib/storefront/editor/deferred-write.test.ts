import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleDeferredWrite } from "./deferred-write";

/**
 * The ordering the style path depends on.
 *
 * None of this needs a browser or a rendered component: the contract is the
 * order of four injected calls. What it pins is the pairing that the two write
 * paths do *not* share — recorded before the write, discarded when the write
 * never lands — so that the extraction those rules were blocking can be judged
 * on evidence rather than on it having been safe so far.
 */

const KEY = "theme:src/components/Hero.tsx";

function harness() {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const record = vi.fn(() => 1);
  const discard = vi.fn();
  const save = vi.fn(
    async (): Promise<{ status: string }> => ({ status: "saved" }),
  );
  const onError = vi.fn();

  return {
    timers,
    record,
    discard,
    save,
    onError,
    args: {
      timers,
      key: KEY,
      delayMs: 300,
      record,
      discard,
      save,
      isConflict: (result: { status: string }) =>
        result.status === "source-conflict",
      onError,
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a write that is recorded before it lands", () => {
  it("puts the entry in the history before the write has happened", async () => {
    const { args, record, save, discard, timers } = harness();

    scheduleDeferredWrite(args);

    // The entry exists while the write does not. Pressing undo inside the
    // debounce window has to find something to reverse.
    expect(record).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(300);

    expect(save).toHaveBeenCalledTimes(1);
    expect(discard).not.toHaveBeenCalled();
    // A timer that has fired is no longer pending.
    expect(timers.size).toBe(0);
  });

  it("takes the entry back when the write reports a conflict", async () => {
    const { args, discard, save } = harness();
    save.mockResolvedValue({ status: "source-conflict" });

    scheduleDeferredWrite(args);
    await vi.advanceTimersByTimeAsync(300);

    // Nothing landed, so an entry left behind would undo an edit that never
    // happened.
    expect(discard).toHaveBeenCalledWith(1);
  });

  it("takes the entry back and reports when the write throws", async () => {
    const { args, discard, onError, save } = harness();
    const failure = new Error("offline");
    save.mockRejectedValue(failure);

    scheduleDeferredWrite(args);
    await vi.advanceTimersByTimeAsync(300);

    expect(discard).toHaveBeenCalledWith(1);
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it("supersedes a pending write for the same key instead of writing twice", async () => {
    const { args, record, save, timers } = harness();

    scheduleDeferredWrite(args);
    scheduleDeferredWrite(args);

    // Two commits, two entries — but only the newer write may go out.
    expect(record).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(300);

    expect(save).toHaveBeenCalledTimes(1);
    expect(timers.size).toBe(0);
  });
});
