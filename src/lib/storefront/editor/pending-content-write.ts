export type PendingContentEntry = {
  sectionId: string;
  props: Record<string, unknown>;
  /** The route the edit was made on; absent for the layout. */
  routePath?: string;
};

/**
 * A rejected content write, carrying the server's own failure code.
 *
 * The code is what tells a conflicted write from one that never arrived. They
 * need different answers — a conflict means the document moved and the author's
 * edit has to be rebased onto it, while a dropped request means nothing changed
 * and the same payload can simply go again — so a caller that can only see the
 * message would have to match on prose to tell them apart.
 */
export type PendingContentFailure = Error & { code?: string };

/** One acknowledgement boundary for debounce, flush and immediate content edits. */
export async function commitPendingContent<
  T extends { success: boolean; message?: string; error?: string },
>({
  key,
  pending,
  baselines,
  save,
  onSaved,
  failureCode,
}: {
  key: string;
  pending: Map<string, PendingContentEntry>;
  baselines: Map<string, Record<string, unknown>>;
  save: (entry: PendingContentEntry) => Promise<T>;
  onSaved?: (
    entry: PendingContentEntry,
    baseline: Record<string, unknown> | undefined,
  ) => void;
  /**
   * The server's code for a rejected write, when it gave one.
   *
   * Required rather than optional. A caller that simply forgot it would turn
   * every conflict into a plain failure, and nothing would say so: the write is
   * refused, the payload is retained, and the author is told only that saving
   * failed — losing the one fact that says their edit is still valid. Making it
   * required means each caller states how it reads the code, and a result shape
   * with none says so with `() => undefined`.
   */
  failureCode: (result: T) => string | undefined;
}): Promise<T | null> {
  const entry = pending.get(key);
  if (!entry) return null;
  const baseline = baselines.get(key);
  const result = await save(entry);
  if (!result.success) {
    const failure: PendingContentFailure = new Error(
      result.message ?? "Content could not be saved. Retry before continuing.",
    );
    const code = failureCode(result);
    if (code) failure.code = code;
    throw failure;
  }
  if (pending.get(key) === entry) {
    pending.delete(key);
    baselines.delete(key);
  } else {
    // A newer edit belongs to the next save, whose undo starts at this ACK.
    baselines.set(key, { ...baseline, ...entry.props });
  }
  onSaved?.(entry, baseline);
  return result;
}
