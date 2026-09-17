/**
 * A write that is recorded before it happens, and un-recorded if it never does.
 *
 * The style path debounces for 300ms because dragging a slider commits a patch
 * per gesture step; awaiting each one would serialize the file save queue behind
 * the author's pointer. The delay is what forces the history entry to be
 * recorded *optimistically* — pressing undo inside the window would otherwise
 * find nothing to reverse — and it is also what forces that entry to be
 * discarded when the write turns out never to have landed. A conflicted write
 * changes nothing on the server, so an entry left behind would undo an edit that
 * never happened.
 *
 * The unified save path does the opposite, and must: it awaits the write and
 * records only once it has landed. The two orders are not interchangeable and
 * the difference is the ordering, not the bookkeeping — which is why this lives
 * apart from that path instead of being folded into one write owner with a mode
 * flag.
 *
 * Extracted from the shell so the ordering can be stated as tests. It renders
 * nothing, holds no state, and reaches nothing outside the ports it is given.
 */

export type DeferredWritePorts<TId, TResult> = Readonly<{
  /** Pending timers, keyed so a newer gesture supersedes its own predecessor. */
  timers: Map<string, ReturnType<typeof setTimeout>>;
  key: string;
  delayMs: number;
  /** Records the entry now and returns the id needed to take it back. */
  record: () => TId;
  discard: (id: TId) => void;
  save: () => Promise<TResult>;
  /** Whether the result means the write never landed. */
  isConflict: (result: TResult) => boolean;
  /** Reports a write that failed outright. */
  onError: (error: unknown) => void;
}>;

export function scheduleDeferredWrite<TId, TResult>(
  ports: DeferredWritePorts<TId, TResult>,
): void {
  const { timers, key, delayMs, record, discard, save, isConflict, onError } =
    ports;

  const pending = timers.get(key);
  if (pending !== undefined) {
    clearTimeout(pending);
  }

  // Recorded here rather than when the write lands: the author can press undo
  // during the debounce window, and an entry that arrives afterwards cannot
  // reverse the edit that is already on screen.
  const id = record();

  const timer = setTimeout(() => {
    timers.delete(key);
    void save()
      .then((result) => {
        // A conflicted write never landed, so there is nothing to reverse.
        if (isConflict(result)) discard(id);
      })
      .catch((error: unknown) => {
        discard(id);
        onError(error);
      });
  }, delayMs);

  timers.set(key, timer);
}
