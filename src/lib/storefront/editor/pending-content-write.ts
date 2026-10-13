import { getFieldPathValue, setFieldPathValue } from "./selection-taxonomy";
import { SELECTION_SOURCE_CONFLICT } from "../theme-write-errors";

export const RESELECT_CONTENT_MESSAGE =
  "The source code has changed. Select the field again. Your changes are kept.";

export type PendingFieldEdit = Readonly<{
  value: unknown;
  sourceGeneration: number | null;
  rejected?: boolean;
}>;

export type PendingContentEntry = {
  sectionId: string;
  props: Record<string, unknown>;
  /** The route the edit was made on; absent for the layout. */
  routePath?: string;
  /** Captured with the edit, never replaced by a later workspace refetch. */
  expectedSourceGeneration?: number;
  /** Immutable per-field input snapshots; not upgraded by selection or retry. */
  fields?: Readonly<Record<string, PendingFieldEdit>>;
};

export function changedContentPaths(
  before: unknown,
  after: unknown,
  path = "",
): string[] {
  if (sameContent(before, after)) return [];
  if (
    Array.isArray(before) &&
    Array.isArray(after) &&
    before.length === after.length
  ) {
    return after.flatMap((value, index) =>
      changedContentPaths(
        before[index],
        value,
        path ? `${path}.${index}` : `${index}`,
      ),
    );
  }
  if (
    before &&
    after &&
    typeof before === "object" &&
    typeof after === "object" &&
    !Array.isArray(before) &&
    !Array.isArray(after)
  ) {
    const prev = before as Record<string, unknown>;
    const next = after as Record<string, unknown>;
    return Object.keys(next).flatMap((key) =>
      changedContentPaths(prev[key], next[key], path ? `${path}.${key}` : key),
    );
  }
  return path ? [path] : [];
}

/** Stage only actual input, not unchanged props re-emitted by the Inspector. */
export function stageContentFields(args: {
  pending?: PendingContentEntry;
  sectionId: string;
  routePath?: string;
  stored: Record<string, unknown>;
  next: Record<string, unknown>;
  inputPath?: string;
  sourceForPath: (path: string) => number | null;
}): PendingContentEntry | null {
  const held = { ...args.stored, ...args.pending?.props };
  const changed = args.inputPath
    ? sameContent(
        getFieldPathValue(held, args.inputPath),
        getFieldPathValue(args.next, args.inputPath),
      )
      ? []
      : [args.inputPath]
    : changedContentPaths(held, { ...held, ...args.next });
  if (changed.length === 0) return args.pending ?? null;
  const fields = { ...args.pending?.fields };
  for (const path of changed) {
    // A structural change owns the whole field, not stale descendant edits.
    for (const old of Object.keys(fields)) {
      if (old.startsWith(`${path}.`)) delete fields[old];
    }
    const generation = args.sourceForPath(path);
    const prior = fields[path];
    fields[path] = {
      value: getFieldPathValue(args.next, path),
      sourceGeneration:
        generation !== null &&
        Number.isSafeInteger(generation) &&
        generation > 0
          ? generation
          : null,
      // Typing again against the same refused version is not confirmation
      // of newer source. Keep it local until a genuinely new capture exists.
      ...(prior?.rejected &&
      (generation === null || generation <= (prior.sourceGeneration ?? 0))
        ? { rejected: true }
        : {}),
    };
  }
  return {
    sectionId: args.sectionId,
    routePath: args.routePath,
    props: { ...args.pending?.props, ...args.next },
    fields,
  };
}

export function fieldsNeedingReselection(
  entry: PendingContentEntry,
  generation: number,
): string[] {
  if (!entry.fields)
    return entry.expectedSourceGeneration === generation
      ? []
      : Object.keys(entry.props);
  return Object.keys(entry.fields).filter(
    (path) =>
      entry.fields![path]!.rejected ||
      entry.fields![path]!.sourceGeneration !== generation,
  );
}

/** Compose only current fields on stored data, never on other pending values. */
export function selectCurrentContentFields(
  entry: PendingContentEntry,
  generation: number,
  stored: Record<string, unknown>,
): PendingContentEntry {
  if (!Number.isSafeInteger(generation) || generation < 1)
    throw sourceSelectionFailure();
  if (!entry.fields) {
    if (entry.expectedSourceGeneration !== generation)
      throw sourceSelectionFailure();
    return entry;
  }
  const fields = Object.fromEntries(
    Object.entries(entry.fields).filter(
      ([, field]) => !field.rejected && field.sourceGeneration === generation,
    ),
  );
  // An unconfirmed parent edit cannot be silently included in a child write.
  for (const path of Object.keys(fields)) {
    if (
      Object.keys(entry.fields).some(
        (parent) =>
          path.startsWith(`${parent}.`) &&
          entry.fields![parent]!.sourceGeneration !== generation,
      )
    )
      delete fields[path];
    const root = path.split(".")[0]!;
    if (
      stored[root] === undefined &&
      Object.keys(entry.fields).some(
        (other) =>
          other.split(".")[0] === root &&
          (entry.fields![other]!.rejected ||
            entry.fields![other]!.sourceGeneration !== generation),
      )
    )
      delete fields[path];
  }
  if (Object.keys(fields).length === 0) throw sourceSelectionFailure();
  let merged = { ...stored };
  for (const [path, field] of Object.entries(fields)) {
    const root = path.split(".")[0]!;
    // An unstored list/object is displayed from defaults. Keep its untouched
    // entries on first edit, but never seed with a differently-versioned draft.
    if (merged[root] === undefined && path.includes("."))
      merged[root] = entry.props[root];
    merged = setFieldPathValue(merged, path, field.value);
  }
  const roots = new Set(Object.keys(fields).map((path) => path.split(".")[0]!));
  return {
    ...entry,
    fields,
    expectedSourceGeneration: generation,
    props: Object.fromEntries([...roots].map((root) => [root, merged[root]])),
  };
}

export function sourceSelectionFailure(): PendingContentFailure {
  return Object.assign(new Error(RESELECT_CONTENT_MESSAGE), {
    code: SELECTION_SOURCE_CONFLICT,
  });
}

/** Remove only the exact field snapshots acknowledged, not newer/unsent edits. */
export function acknowledgeContentFields(
  pending: Map<string, PendingContentEntry>,
  key: string,
  sent: PendingContentEntry,
): boolean {
  const now = pending.get(key);
  if (!now || !sent.fields || !now.fields) return false;
  const remaining = { ...now.fields };
  for (const [path, field] of Object.entries(sent.fields)) {
    if (remaining[path] === field) delete remaining[path];
  }
  if (Object.keys(remaining).length === 0) pending.delete(key);
  else {
    const roots = new Set(
      Object.keys(remaining).map((path) => path.split(".")[0]!),
    );
    pending.set(key, {
      ...now,
      fields: remaining,
      props: Object.fromEntries(
        [...roots].map((root) => [root, now.props[root]]),
      ),
    });
  }
  return true;
}

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
  select,
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
  select?: (entry: PendingContentEntry) => PendingContentEntry;
}): Promise<T | null> {
  const held = pending.get(key);
  if (!held) return null;
  const entry = select ? select(held) : held;
  const baseline = baselines.get(key);
  const result = await save(entry);
  if (!result.success) {
    const failure: PendingContentFailure = new Error(
      result.message ?? "Content could not be saved. Retry before continuing.",
    );
    const code = failureCode(result);
    if (code) failure.code = code;
    if (code === SELECTION_SOURCE_CONFLICT && entry.fields) {
      const now = pending.get(key);
      if (now?.fields) {
        const fields = { ...now.fields };
        for (const [path, field] of Object.entries(entry.fields)) {
          if (fields[path] === field)
            fields[path] = { ...field, rejected: true };
        }
        pending.set(key, { ...now, fields });
      }
    }
    throw failure;
  }
  if (acknowledgeContentFields(pending, key, entry)) {
    if (!pending.has(key)) baselines.delete(key);
    else baselines.set(key, { ...baseline, ...entry.props });
  } else if (pending.get(key) === entry) {
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
