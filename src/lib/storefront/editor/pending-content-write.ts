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

/**
 * Whether a section, as the server holds it, already has every value a
 * content write sent — by content, not by reference.
 *
 * The server merges a content write into the section's props (`enabled` goes
 * to the section itself), so a landed write is one whose every sent value is
 * there. Values the server normalises differently answer "no", which is the
 * safe side: the write is then sent again under its draft generation, and a
 * document that moved turns it into the existing conflict, never an
 * overwrite.
 */
export function sectionContentLanded(
  sent: PendingContentEntry,
  section: { props?: unknown; enabled?: boolean } | undefined,
): boolean {
  if (!section) return false;
  const held = (section.props ?? {}) as Record<string, unknown>;
  return Object.entries(sent.props).every(([key, value]) =>
    key === "enabled"
      ? (section.enabled !== false) === value
      : sameContent(held[key], value),
  );
}

/** Equal as stored content: the same JSON values, in any key order. */
export function sameContent(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameContent(item, right[index]))
    );
  }
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }
  const leftEntries = Object.entries(left).filter(([, v]) => v !== undefined);
  const rightRecord = right as Record<string, unknown>;
  const rightKeys = Object.keys(rightRecord).filter(
    (key) => rightRecord[key] !== undefined,
  );
  return (
    leftEntries.length === rightKeys.length &&
    leftEntries.every(([key, value]) => sameContent(value, rightRecord[key]))
  );
}

/**
 * A pending-content map that says when it changes.
 *
 * The map is written from a dozen places — edits, acknowledgements, rebases,
 * checks of unanswered writes — and whether anything is still unsaved has to
 * be shown the moment any of them changes it. Reporting from the map itself
 * means no write site can forget to.
 */
export class ObservedPendingContent extends Map<string, PendingContentEntry> {
  private readonly onChange: () => void;

  constructor(onChange: () => void) {
    super();
    this.onChange = onChange;
  }

  override set(key: string, value: PendingContentEntry): this {
    super.set(key, value);
    this.onChange();
    return this;
  }

  override delete(key: string): boolean {
    const deleted = super.delete(key);
    if (deleted) this.onChange();
    return deleted;
  }

  override clear(): void {
    const had = this.size > 0;
    super.clear();
    if (had) this.onChange();
  }
}
