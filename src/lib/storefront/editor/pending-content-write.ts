import { getFieldPathValue, setFieldPathValue } from "./selection-taxonomy";
import {
  SELECTION_SOURCE_CONFLICT,
  TEMPLATE_DRAFT_CONFLICT,
} from "../theme-write-errors";
import {
  basisWithinOwnRange,
  rowIdentitiesAt,
  rowsStillMatch,
  type ContentSnapshot,
  type RowIdentity,
} from "./content-write-snapshot";

export const RESELECT_CONTENT_MESSAGE =
  "The source code has changed. Select the field again. Your changes are kept.";

export type PendingFieldEdit = Readonly<{
  value: unknown;
  sourceGeneration: number | null;
  rejected?: boolean;
  /**
   * The draft generation of the document this input was made on. A write may
   * compose it onto a later copy only when every step since was this
   * session's own (`ContentSnapshot.ownSince`).
   */
  basisDraftGeneration?: number;
  /** The rows the field's path passed through when it was typed, by id. */
  rows?: readonly RowIdentity[];
}>;

export type PendingContentEntry = {
  sectionId: string;
  props: Record<string, unknown>;
  /** The route the edit was made on; absent for the layout. */
  routePath?: string;
  /** Captured with the edit, never replaced by a later workspace refetch. */
  expectedSourceGeneration?: number;
  /**
   * The draft generation of the snapshot `props` was composed on, set when a
   * write is prepared: the generation and the stored copy come from one read.
   */
  expectedDraftGeneration?: number;
  /** Whether confirmation should add the generic Content history entry. */
  recordHistory?: boolean;
  /** Immutable per-field input snapshots; not upgraded by selection or retry. */
  fields?: Readonly<Record<string, PendingFieldEdit>>;
  /** Array paths changed by an Inspector Add/Remove action, for local recovery UI. */
  listActionPaths?: readonly string[];
  /**
   * Keys the write removes from the section ("Use code default", or the
   * undo of a write that first stored them), sent as `resetProps`. Present
   * only on a write that removes keys; a read-back counts it landed only once
   * every one of them is gone.
   */
  resetProps?: readonly string[];
};

/**
 * A write as it was sent, frozen: its props, removed keys and generations
 * are what a read-back is compared with and what a retry sends again, so
 * nothing typed after it may change them.
 */
export function sentContentWrite(
  entry: PendingContentEntry,
  expectedDraftGeneration?: number,
  recordHistory?: boolean,
): Readonly<PendingContentEntry> {
  return Object.freeze({
    ...entry,
    ...(expectedDraftGeneration !== undefined
      ? { expectedDraftGeneration }
      : {}),
    ...(recordHistory !== undefined ? { recordHistory } : {}),
    props: Object.freeze({ ...entry.props }),
    ...(entry.resetProps !== undefined
      ? { resetProps: Object.freeze([...entry.resetProps]) }
      : {}),
    ...(entry.listActionPaths !== undefined
      ? { listActionPaths: Object.freeze([...entry.listActionPaths]) }
      : {}),
  });
}

/** Whether a frozen content write includes a path or one of its descendants. */
export function contentEntryTouchesPath(
  entry: PendingContentEntry,
  path: string,
): boolean {
  if (!path || path.split(".").some((segment) => !segment)) return false;
  const touches = (candidate: string) =>
    candidate === path || candidate.startsWith(`${path}.`);
  return [
    ...(entry.listActionPaths ?? []),
    ...Object.keys(entry.fields ?? {}),
    ...(entry.resetProps ?? []),
  ].some(touches);
}

/** Whether one unanswered write belongs to the selected document and list. */
export function hasUnconfirmedContentForList(args: {
  entries: Iterable<readonly [string, PendingContentEntry]>;
  sectionId: string;
  fieldPath: string;
  templateId: string;
  templateIdForKey: (key: string, sectionId: string) => string | null;
  sameTemplateOwner: (left: string, right: string) => boolean;
}): boolean {
  return Array.from(args.entries).some(([key, entry]) => {
    if (entry.sectionId !== args.sectionId) return false;
    const entryTemplateId = args.templateIdForKey(key, entry.sectionId);
    return (
      entryTemplateId !== null &&
      args.sameTemplateOwner(entryTemplateId, args.templateId) &&
      contentEntryTouchesPath(entry, args.fieldPath)
    );
  });
}

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
  /** The draft generation of the document the author was editing. */
  basisDraftGeneration?: number;
  /** The list changed by an explicit Add/Remove control action. */
  listActionPath?: string;
}): PendingContentEntry | null {
  const held = { ...args.stored, ...args.pending?.props };
  // The rows as the author's input saw them: the input itself, over what was
  // already held.
  const view = { ...held, ...args.next };
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
    const rows = rowIdentitiesAt(view, path);
    // The copy this field's pending input was first made on. Typing into it
    // again does not move it onto a later copy the editor has read since:
    // the author kept typing on their own text, not on that copy. Only an
    // answered write (the field leaves the pending set) or the author's
    // "keep mine" (`rebaseFieldBasis`) moves it.
    //
    // An input made with no basis (no copy of the document was held when the
    // author acted) keeps none: a later keystroke made while a copy is held
    // does not give the field that copy as its basis. Unknown is the
    // earliest copy of all.
    const earlier = Object.entries(fields)
      .filter(([old]) => old === path || old.startsWith(`${path}.`))
      .map(([, field]) => field.basisDraftGeneration);
    earlier.push(args.basisDraftGeneration);
    const basisDraftGeneration = earlier.some((basis) => basis === undefined)
      ? undefined
      : Math.min(...(earlier as number[]));
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
      ...(basisDraftGeneration !== undefined ? { basisDraftGeneration } : {}),
      ...(rows.length > 0 ? { rows } : {}),
    };
  }
  return {
    sectionId: args.sectionId,
    routePath: args.routePath,
    props: { ...args.pending?.props, ...args.next },
    fields,
    ...(args.pending?.listActionPaths || args.listActionPath
      ? {
          listActionPaths: [
            ...new Set([
              ...(args.pending?.listActionPaths ?? []),
              ...(args.listActionPath ? [args.listActionPath] : []),
            ]),
          ],
        }
      : {}),
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

/**
 * Compose only current fields on stored data, never on other pending values.
 *
 * With a `snapshot`, `stored` is that snapshot's copy of the section and the
 * write takes its draft generation, so what is composed and the generation
 * it is sent with come from one read. Every field that would be sent must
 * have been made on a copy this one only follows through this session's own
 * writes, and in the same rows, found by id; otherwise nothing is sent and
 * the section is out of date, the input kept, as if the server had refused it.
 */
export function selectCurrentContentFields(
  entry: PendingContentEntry,
  generation: number,
  stored: Record<string, unknown>,
  snapshot?: ContentSnapshot,
  options?: {
    /**
     * The copy a field with no recorded basis counts as made on: only input
     * made before its route document existed, on a document this editor
     * confirmed creating (generation 1). Unset, such a field is refused
     * (`missingBasisFailure`): nothing names the copy it was made on.
     */
    missingBasis?: number;
  },
): PendingContentEntry {
  if (!Number.isSafeInteger(generation) || generation < 1)
    throw sourceSelectionFailure();
  if (!entry.fields) {
    if (entry.expectedSourceGeneration !== generation)
      throw sourceSelectionFailure();
    if (!snapshot) return entry;
    // No per-field record, so no basis: composed onto a copy only as the
    // route-document exception allows.
    if (options?.missingBasis === undefined) throw missingBasisFailure();
    if (!basisWithinOwnRange(snapshot, options.missingBasis))
      throw draftConflictFailure();
    return { ...entry, expectedDraftGeneration: snapshot.draftGeneration };
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
  if (snapshot) {
    for (const [path, field] of Object.entries(fields)) {
      const root = path.split(".")[0]!;
      // Checked against what the field is composed onto: a list nothing
      // stores yet is the author's own copy of its defaults (below).
      const base =
        stored[root] === undefined
          ? { ...stored, [root]: entry.props[root] }
          : stored;
      const basis = field.basisDraftGeneration ?? options?.missingBasis;
      // Made with no basis: refused before anything is sent, never checked
      // against (or sent at) whatever copy is held now.
      if (basis === undefined) throw missingBasisFailure();
      if (
        !basisWithinOwnRange(snapshot, basis) ||
        !rowsStillMatch(base, path, field.rows)
      ) {
        throw draftConflictFailure();
      }
    }
  }
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
    ...(snapshot ? { expectedDraftGeneration: snapshot.draftGeneration } : {}),
    props: Object.fromEntries([...roots].map((root) => [root, merged[root]])),
  };
}

export function sourceSelectionFailure(): PendingContentFailure {
  return Object.assign(new Error(RESELECT_CONTENT_MESSAGE), {
    code: SELECTION_SOURCE_CONFLICT,
  });
}

/**
 * The section moved under a pending input in a way it cannot be composed
 * onto: someone else's change since it was typed, or its row is no longer at
 * its path. Reported as the out-of-date answer the server gives, so the
 * existing update — load the latest, keep mine — is the way on.
 */
export function draftConflictFailure(): PendingContentFailure {
  return Object.assign(
    new Error(
      "This section changed elsewhere since you edited it. Your changes are kept.",
    ),
    { code: TEMPLATE_DRAFT_CONFLICT },
  );
}

/**
 * Said when a content write was made with no version basis: the editor held
 * no copy of the document when the author acted (the latest accepted
 * snapshot generation then), so it cannot say which version was edited.
 */
export const MISSING_BASIS_MESSAGE =
  "Not saved: the editor could not confirm which version of this page you edited. Load the latest, reselect, and try again.";

/**
 * A content write made with no version basis, refused before it is sent.
 * Reported as out of date (`TEMPLATE_DRAFT_CONFLICT`), so the input is kept
 * and the existing "Load latest, keep mine" is the author's way on; marked
 * `missingBasis` so the author is told why.
 */
export function missingBasisFailure(): PendingContentFailure & {
  missingBasis: true;
} {
  return Object.assign(new Error(MISSING_BASIS_MESSAGE), {
    code: TEMPLATE_DRAFT_CONFLICT,
    missingBasis: true as const,
  });
}

export function isMissingBasisFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { missingBasis?: unknown }).missingBasis === true
  );
}

/**
 * The author chose to keep their pending input on the latest document (load
 * the latest, keep mine): its fields now count as made on that copy. Their
 * rows are not re-pointed; a row no longer at its path still refuses.
 */
export function rebaseFieldBasis(
  entry: PendingContentEntry,
  draftGeneration: number,
): PendingContentEntry {
  if (!entry.fields) return entry;
  return {
    ...entry,
    fields: Object.fromEntries(
      Object.entries(entry.fields).map(([path, field]) => [
        path,
        { ...field, basisDraftGeneration: draftGeneration },
      ]),
    ),
  };
}

/** Drop one conflicted list while keeping all sibling pending field snapshots. */
export function discardPendingContentPath(args: {
  entry: PendingContentEntry;
  baseline: Record<string, unknown> | undefined;
  incoming: Record<string, unknown>;
  fieldPath: string;
}): {
  pending: PendingContentEntry | null;
  baseline: Record<string, unknown>;
} {
  const { entry, incoming, fieldPath } = args;
  if (!fieldPath || fieldPath.split(".").some((segment) => !segment)) {
    throw new Error("A content field path is required to discard a list.");
  }

  const overlapsDiscardedPath = (path: string) =>
    path === fieldPath || path.startsWith(`${fieldPath}.`);
  const baseline = replaceFieldPath(args.baseline ?? {}, incoming, fieldPath);

  if (!entry.fields) {
    const props = { ...entry.props };
    deleteFieldPath(props, fieldPath);
    const incomingValue = getFieldPathValue(incoming, fieldPath);
    if (incomingValue !== undefined)
      Object.assign(props, setFieldPathValue({}, fieldPath, incomingValue));
    return {
      pending: Object.keys(props).length > 0 ? { ...entry, props } : null,
      baseline,
    };
  }

  const fields = Object.fromEntries(
    Object.entries(entry.fields).filter(
      ([path]) => !overlapsDiscardedPath(path),
    ),
  );
  if (Object.keys(fields).length === 0) return { pending: null, baseline };

  let props: Record<string, unknown> = { ...incoming };
  for (const [path, field] of Object.entries(fields)) {
    props = setFieldPathValue(props, path, field.value);
  }
  return {
    pending: {
      ...entry,
      fields,
      props,
      ...(entry.listActionPaths
        ? {
            listActionPaths: entry.listActionPaths.filter(
              (path) => !overlapsDiscardedPath(path),
            ),
          }
        : {}),
    },
    baseline,
  };
}

function replaceFieldPath(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  path: string,
): Record<string, unknown> {
  const next = { ...target };
  const sourceValue = getFieldPathValue(source, path);
  if (sourceValue === undefined) deleteFieldPath(next, path);
  else return setFieldPathValue(next, path, sourceValue);
  return next;
}

function deleteFieldPath(target: Record<string, unknown>, path: string): void {
  const segments = path.split(".");
  let current: unknown = target;
  for (const segment of segments.slice(0, -1)) {
    if (current === null || typeof current !== "object") return;
    const key = /^\d+$/.test(segment) ? Number(segment) : segment;
    current = (current as Record<string | number, unknown>)[key];
  }
  if (current === null || typeof current !== "object") return;
  const last = segments.at(-1)!;
  const key = /^\d+$/.test(last) ? Number(last) : last;
  if (Array.isArray(current) && typeof key === "number") current.splice(key, 1);
  else delete (current as Record<string | number, unknown>)[key];
}

/**
 * The draft generation a route document has when it is created. Input made
 * while its route had no document counts as made on that copy: composed
 * later, it may only go onto one whose every step since was this session's.
 */
export const ROUTE_DOCUMENT_CREATED_GENERATION = 1;

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
      ...(now.listActionPaths
        ? {
            listActionPaths: now.listActionPaths.filter((path) =>
              Object.keys(remaining).some(
                (fieldPath) =>
                  fieldPath === path || fieldPath.startsWith(`${path}.`),
              ),
            ),
          }
        : {}),
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
  saveWhenSent,
  onSaved,
  acknowledgeOwn = false,
  failureCode,
  select,
  own,
}: {
  key: string;
  pending: Map<string, PendingContentEntry>;
  baselines: Map<string, Record<string, unknown>>;
  /**
   * A write of its own (a history replay), sent instead of the section's
   * pending input and never merged with it: input typed while it is out
   * stays pending, unacknowledged, for its own save. On success only that
   * input's baseline moves past what this write stored.
   */
  own?: PendingContentEntry;
  /** Sends a write composed now. Exactly one of this and `saveWhenSent`. */
  save?: (entry: PendingContentEntry) => Promise<T>;
  /**
   * Sends a write composed when it is actually sent: `prepare` is called at
   * that moment (after anything queued ahead of it), so the stored copy, the
   * draft generation and the rows it is checked against are the ones current
   * then, not when the save was asked for.
   */
  saveWhenSent?: (prepare: () => PendingContentEntry) => Promise<T>;
  onSaved?: (
    entry: PendingContentEntry,
    baseline: Record<string, unknown> | undefined,
  ) => void;
  /** A frozen ordinary write is resent as `own`, but still acknowledges its input. */
  acknowledgeOwn?: boolean;
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
  const held = own ?? pending.get(key);
  if (!held) return null;
  const baseline = baselines.get(key);
  let prepared: PendingContentEntry | undefined;
  const prepare = () => {
    const now = own ?? pending.get(key) ?? held;
    prepared = select ? select(now) : now;
    return prepared;
  };
  let result: T;
  if (saveWhenSent) {
    result = await saveWhenSent(prepare);
  } else {
    result = await save!(prepare());
  }
  const entry = prepared;
  if (!entry) {
    throw new Error("A content write was sent without being prepared.");
  }
  if (!result.success) {
    const failure: PendingContentFailure = new Error(
      result.message ?? "Content could not be saved. Retry before continuing.",
    );
    const code = failureCode(result);
    if (code) failure.code = code;
    // Only the section's own pending input is marked refused; a write of its
    // own carries none of it.
    if (code === SELECTION_SOURCE_CONFLICT && entry.fields && !own) {
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
  if (own) {
    if (acknowledgeOwn) {
      if (acknowledgeContentFields(pending, key, entry)) {
        if (!pending.has(key)) baselines.delete(key);
        else baselines.set(key, { ...baseline, ...entry.props });
      } else {
        const now = pending.get(key);
        if (!now || sameContent(now.props, entry.props)) {
          pending.delete(key);
          baselines.delete(key);
        } else {
          baselines.set(key, { ...baseline, ...entry.props });
        }
      }
    } else {
      // A history replay is not the section's pending input. Input typed
      // while it was out is preserved, with its baseline moved past the replay.
      if (pending.has(key)) {
        baselines.set(key, { ...baselines.get(key), ...entry.props });
      } else {
        baselines.delete(key);
      }
    }
    onSaved?.(entry, baseline);
    return result;
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
  return (
    Object.entries(sent.props).every(([key, value]) =>
      key === "enabled"
        ? (section.enabled !== false) === value
        : sameContent(held[key], value),
    ) &&
    // A removed key is gone only when the section no longer holds it at
    // all; one held with the value `undefined` is still held. With nothing
    // in `props`, this is the whole test: `props: {}` alone never landed.
    (sent.resetProps ?? []).every(
      (key) => !Object.prototype.hasOwnProperty.call(held, key),
    )
  );
}

/** What reading back an unanswered write found, as the settle reads it. */
export type UnconfirmedContentRead =
  | Readonly<{ ok: false }>
  | Readonly<{
      ok: true;
      template?: Readonly<{
        draftGeneration?: number;
        section?: Readonly<{ props?: unknown; enabled?: boolean }>;
      }>;
    }>;

export type UnconfirmedContentOutcome =
  /** This write produced the read-back: nothing to send, history may move. */
  | "landed"
  /** Nothing moved and the write is not there: may be sent again, as sent. */
  | "not-landed"
  /** Something else happened, or it cannot be told apart: never resent. */
  | "moved"
  /** The read failed: nothing is decided. */
  | "undecided";

/**
 * Whether an unanswered content write landed, decided by the draft
 * generation first and the content second.
 *
 * - exactly one generation on, and every sent value and removal there:
 *   landed, the one step being this write's;
 * - the generation unchanged and the content not all there: not landed;
 * - anything else — one generation on with any mismatch, the generation
 *   unchanged with everything already there (it cannot be shown that this
 *   request did it), any other generation, a missing template or section,
 *   or no generation recorded for the write — moved.
 *
 * A partial content mismatch alone never makes a write "not landed": the
 * only write that may be resent is one nothing has happened to.
 */
export function classifyUnconfirmedContent(
  sent: PendingContentEntry,
  read: UnconfirmedContentRead,
): UnconfirmedContentOutcome {
  if (!read.ok) return "undecided";
  const template = read.template;
  const section = template?.section;
  const sentAt = sent.expectedDraftGeneration;
  const now = template?.draftGeneration;
  if (
    !template ||
    !section ||
    typeof sentAt !== "number" ||
    !Number.isSafeInteger(sentAt) ||
    typeof now !== "number" ||
    !Number.isSafeInteger(now)
  ) {
    return "moved";
  }
  const applied = sectionContentLanded(sent, section);
  if (now === sentAt) return applied ? "moved" : "not-landed";
  if (now === sentAt + 1) return applied ? "landed" : "moved";
  return "moved";
}

/**
 * What undoing a saved content write puts back, for each key it wrote.
 *
 * A key the section stored before the write gets that value written back —
 * `null` included. A key it did not store at all is removed again (the "Use
 * code default" reset): writing back `undefined` sends nothing, and writing
 * back what the panel drew would pin the component's defaults in the
 * Document. Decided by whether the key was there, never by its value.
 *
 * `enabled` lives on the section, not in its props, and is not a field that
 * can be reset; it is put back as before.
 */
export function contentUndoSteps(
  baseline: Readonly<Record<string, unknown>>,
  written: Readonly<Record<string, unknown>>,
): { restore: Record<string, unknown>; reset: string[] } {
  const restore: Record<string, unknown> = {};
  const reset: string[] = [];
  for (const key of Object.keys(written)) {
    if (
      key !== "enabled" &&
      !Object.prototype.hasOwnProperty.call(baseline, key)
    ) {
      reset.push(key);
    } else {
      restore[key] = baseline[key];
    }
  }
  return { restore, reset };
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
