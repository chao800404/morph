export type PendingContentEntry = {
  sectionId: string;
  props: Record<string, unknown>;
};

/** One acknowledgement boundary for debounce, flush and immediate content edits. */
export async function commitPendingContent<
  T extends { success: boolean; message?: string },
>({
  key,
  pending,
  baselines,
  save,
  onSaved,
}: {
  key: string;
  pending: Map<string, PendingContentEntry>;
  baselines: Map<string, Record<string, unknown>>;
  save: (entry: PendingContentEntry) => Promise<T>;
  onSaved?: (
    entry: PendingContentEntry,
    baseline: Record<string, unknown> | undefined,
  ) => void;
}): Promise<T | null> {
  const entry = pending.get(key);
  if (!entry) return null;
  const baseline = baselines.get(key);
  const result = await save(entry);
  if (!result.success)
    throw new Error(
      result.message ?? "Content could not be saved. Retry before continuing.",
    );
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
