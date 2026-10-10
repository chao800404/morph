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
 *
 * The write waits in `writes` rather than behind a bare timer, so leaving the
 * page can send it now through this same ordering (`DebouncedWrites.flush`).
 */

import type { DebouncedWrites } from "./debounced-writes";

export type DeferredWritePorts<TId, TResult> = Readonly<{
  /** Waiting writes, keyed so a newer gesture supersedes its own predecessor. */
  writes: DebouncedWrites;
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
  const { writes, key, delayMs, record, discard, save, isConflict, onError } =
    ports;

  // Recorded here rather than when the write lands: the author can press undo
  // during the debounce window, and an entry that arrives afterwards cannot
  // reverse the edit that is already on screen.
  const id = record();

  writes.schedule(key, delayMs, () =>
    save()
      .then((result) => {
        // A conflicted write never landed, so there is nothing to reverse.
        if (isConflict(result)) discard(id);
      })
      .catch((error: unknown) => {
        discard(id);
        onError(error);
      }),
  );
}
