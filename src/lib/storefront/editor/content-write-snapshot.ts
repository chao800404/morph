/**
 * The document a content write is composed on, kept whole with the draft
 * generation it was read or written at.
 *
 * A content write sends some fields of a section, composed onto the section
 * as stored, together with the draft generation that stored copy belongs to.
 * The two have to come from one read of the document: fields composed on an
 * older copy and sent with a newer generation would be accepted by OCC and
 * write the older copy's other values back over a change made since — and a
 * row field addressed by index would land on whichever row took that index.
 *
 * A snapshot is therefore only ever replaced whole, and only by a newer one.
 * It also records how far back every step to it was this session's own
 * write (`ownSince`): an input made on a copy within that range may be
 * composed on this one, while an input older than an outside change may not —
 * it is refused as out of date, as the server would refuse it, never quietly
 * rebased over the other writer's change.
 */
export type SnapshotSection = Readonly<{
  id: string;
  props?: unknown;
  enabled?: boolean;
}>;

export type ContentSnapshot = Readonly<{
  draftGeneration: number;
  sections: readonly SnapshotSection[];
  /** The oldest generation from which every step to this one was ours. */
  ownSince: number;
}>;

/**
 * Generations this session's own writes produced, each mapped from the
 * generation it was sent at to the one it returned.
 */
export type OwnDraftSteps = ReadonlyMap<number, number>;

function validGeneration(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Whether a chain of this session's own steps leads from `from` to `to`. */
function ownChainReaches(
  from: number,
  to: number,
  steps: OwnDraftSteps,
): boolean {
  let at = from;
  const seen = new Set<number>();
  while (at < to) {
    if (seen.has(at)) return false;
    seen.add(at);
    const next = steps.get(at);
    if (next === undefined || next <= at) return false;
    at = next;
  }
  return at === to;
}

/**
 * The snapshot after reading the document (an editor refetch, a read-back).
 *
 * A read at the same or an older generation changes nothing. A newer read
 * replaces the snapshot whole; it keeps the own range only when every step
 * from the current snapshot to it was this session's own write, which is how
 * a read that merely catches up with our writes differs from one that brings
 * someone else's.
 */
export function acceptReadSnapshot(
  current: ContentSnapshot | undefined,
  read: Readonly<{
    draftGeneration: unknown;
    sections: readonly SnapshotSection[];
  }>,
  steps: OwnDraftSteps,
): ContentSnapshot | undefined {
  if (!validGeneration(read.draftGeneration)) return current;
  if (current && read.draftGeneration <= current.draftGeneration)
    return current;
  const ownSince =
    current &&
    ownChainReaches(current.draftGeneration, read.draftGeneration, steps)
      ? current.ownSince
      : read.draftGeneration;
  return {
    draftGeneration: read.draftGeneration,
    sections: read.sections,
    ownSince,
  };
}

/**
 * The snapshot after one of this session's own writes was acknowledged with
 * the document it wrote.
 *
 * Accepted only as the direct successor of the snapshot it was composed on;
 * a late answer to an older write, or one whose basis is not the current
 * snapshot, changes nothing (the next read will bring the document).
 */
export function acceptOwnSnapshot(
  current: ContentSnapshot | undefined,
  ack: Readonly<{
    sentAt: number;
    draftGeneration: unknown;
    sections: readonly SnapshotSection[] | undefined;
  }>,
): ContentSnapshot | undefined {
  if (!validGeneration(ack.draftGeneration) || !ack.sections) return current;
  if (!current || current.draftGeneration !== ack.sentAt) return current;
  if (ack.draftGeneration <= current.draftGeneration) return current;
  return {
    draftGeneration: ack.draftGeneration,
    sections: ack.sections,
    ownSince: current.ownSince,
  };
}

/** Whether an input made on the copy at `basis` may be composed on `snapshot`. */
export function basisWithinOwnRange(
  snapshot: ContentSnapshot,
  basis: number | undefined,
): boolean {
  if (basis === undefined) return true;
  return basis >= snapshot.ownSince && basis <= snapshot.draftGeneration;
}

/** The older of two copies an input may have been made on; either may be unknown. */
export function earlierBasis(
  a: number | undefined,
  b: number | undefined,
): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}

/** One section's stored props in a snapshot. */
export function snapshotSectionProps(
  snapshot: ContentSnapshot,
  sectionId: string,
): Record<string, unknown> {
  const section = snapshot.sections.find((entry) => entry.id === sectionId);
  return { ...((section?.props ?? {}) as Record<string, unknown>) };
}

/**
 * A row along a field's path, by the id that tells it apart from its
 * neighbours — `null` when nothing does.
 */
export type RowIdentity = Readonly<{ rowPath: string; id: string | null }>;

function rowId(row: unknown): string | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const id = (row as { id?: unknown }).id;
  return typeof id === "string" && id.trim().length > 0 ? id : null;
}

/**
 * The rows a field path passes through, with the id each had in `props`.
 *
 * `items.1.title` passes through the row at `items.1`; nested lists add one
 * entry per level. A path through no list has none. A row with no id, a
 * blank one, or one another row of the same list shares is recorded without
 * an id: nothing but its index would say which row it is.
 */
export function rowIdentitiesAt(
  props: Readonly<Record<string, unknown>>,
  path: string,
): RowIdentity[] {
  const segments = path.split(".");
  const rows: RowIdentity[] = [];
  let value: unknown = props;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    if (Array.isArray(value) && /^\d+$/.test(segment)) {
      // A row that is not there is not recorded, so a row that went away
      // cannot match the one an input was made in.
      if (Number(segment) >= value.length) break;
      const row = value[Number(segment)];
      const id = rowId(row);
      const shared =
        id !== null &&
        value.some(
          (other, at) => at !== Number(segment) && rowId(other) === id,
        );
      rows.push({
        rowPath: segments.slice(0, index + 1).join("."),
        id: shared ? null : id,
      });
      value = row;
      continue;
    }
    value =
      value && typeof value === "object"
        ? (value as Record<string, unknown>)[segment]
        : undefined;
  }
  return rows;
}

/**
 * Whether every row a field was made in is still the row at its path.
 *
 * Only a row known by its own id can be: one without (when it was typed or
 * now) is refused, never matched by index — two rows lacking an id are not
 * thereby the same row.
 */
export function rowsStillMatch(
  stored: Readonly<Record<string, unknown>>,
  path: string,
  rows: readonly RowIdentity[] | undefined,
): boolean {
  if (!rows || rows.length === 0) return true;
  const now = new Map(
    rowIdentitiesAt(stored, path).map((row) => [row.rowPath, row.id]),
  );
  return rows.every(
    (row) => row.id !== null && now.get(row.rowPath) === row.id,
  );
}
