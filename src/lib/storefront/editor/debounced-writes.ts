/**
 * Writes waiting out a debounce, kept with what they would run.
 *
 * A bare map of timers can only be cancelled. Leaving the page needs more than
 * that: the write has to go now, through the same code it would have run when
 * its timer fired, and the caller has to be able to wait for it. Cancelling and
 * re-deriving the write elsewhere would be a second write path with its own
 * idea of what to send.
 */
export type DebouncedWrites = {
  /** Replaces any write already waiting under `key`. */
  schedule: (key: string, delayMs: number, run: () => Promise<unknown>) => void;
  /** Drops a waiting write without running it; true if one was waiting. */
  cancel: (key: string) => boolean;
  has: (key: string) => boolean;
  keys: () => string[];
  readonly size: number;
  /**
   * Runs the waiting writes (those `match` accepts) now instead of when their
   * delay ends, and resolves once each has settled. A run that rejects does
   * not stop the others; how it went is read from the state it left behind.
   */
  flush: (match?: (key: string) => boolean) => Promise<void>;
};

export function createDebouncedWrites(
  timers: {
    set: (run: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
    clear: (timer: ReturnType<typeof setTimeout>) => void;
  } = {
    set: (run, delayMs) => setTimeout(run, delayMs),
    clear: (timer) => clearTimeout(timer),
  },
): DebouncedWrites {
  const waiting = new Map<
    string,
    { timer: ReturnType<typeof setTimeout>; run: () => Promise<unknown> }
  >();

  const cancel = (key: string) => {
    const entry = waiting.get(key);
    if (!entry) return false;
    timers.clear(entry.timer);
    waiting.delete(key);
    return true;
  };

  return {
    schedule: (key, delayMs, run) => {
      cancel(key);
      const timer = timers.set(() => {
        waiting.delete(key);
        void run().catch(() => {});
      }, delayMs);
      waiting.set(key, { timer, run });
    },
    cancel,
    has: (key) => waiting.has(key),
    keys: () => Array.from(waiting.keys()),
    get size() {
      return waiting.size;
    },
    flush: async (match) => {
      const due = Array.from(waiting).filter(([key]) => !match || match(key));
      for (const [key] of due) cancel(key);
      await Promise.allSettled(due.map(async ([, entry]) => entry.run()));
    },
  };
}
