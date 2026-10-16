/** A selection's source precondition, not a new workspace version counter. */
export type SelectionSourceBaseline = Readonly<{
  selectionKey: string;
  sourceGeneration: number;
}>;

/** Field selection must not grant a baseline to another field in its section. */
export function fieldSelectionKey(
  sectionId: string,
  path: string,
  routePath = "/",
): string {
  return JSON.stringify([routePath, sectionId, path]);
}

/** A fresh content selection does not accept remote source for Code saves. */
export function sourceGenerationForFreshSelection(args: {
  accepted: number;
  observed: number;
  confirmedPreview: number | null;
  hasLocalSourceChanges: boolean;
}): number | null {
  const current = Math.max(args.accepted, args.observed);
  if (
    !Number.isSafeInteger(current) ||
    current < 1 ||
    args.hasLocalSourceChanges
  )
    return null;
  if (current === args.accepted) return current;
  return args.confirmedPreview === current ? current : null;
}

export function captureSelectionSourceBaseline(
  selectionKey: string,
  sourceGeneration: number,
): SelectionSourceBaseline | null {
  if (
    !selectionKey ||
    !Number.isSafeInteger(sourceGeneration) ||
    sourceGeneration < 1
  )
    return null;
  return { selectionKey, sourceGeneration };
}

/** Reads may invalidate a baseline; they must never silently advance it. */
export function selectionSourceIsCurrent(
  baseline: SelectionSourceBaseline | null,
  selectionKey: string,
  currentSourceGeneration: number,
): boolean {
  return (
    baseline !== null &&
    baseline.selectionKey === selectionKey &&
    baseline.sourceGeneration === currentSourceGeneration
  );
}

/**
 * The source generation a proven field's write is staged at.
 *
 * A field the selected element provably binds without being its selected
 * field (an image's position beside its `image`) has no baseline of its own:
 * it is held to the one its selection captured. In a list that holds only
 * while the stored row at the field's index is still the row the selection
 * named by id; a row moved since answers `null`, so the write is refused for
 * a fresh selection rather than given to whichever row took the index.
 * Nothing here advances or copies a baseline.
 */
export function provenFieldSourceGeneration(args: {
  /** The section's props as stored, not as edited locally. */
  stored: Readonly<Record<string, unknown>>;
  path: string;
  itemId: string | null;
  selectionBaseline: SelectionSourceBaseline | null;
  readPath: (props: Readonly<Record<string, unknown>>, path: string) => unknown;
}): number | null {
  const rowPath = args.path.split(".").slice(0, -1).join(".");
  if (rowPath) {
    const row = args.readPath(args.stored, rowPath);
    if (
      !args.itemId ||
      !row ||
      typeof row !== "object" ||
      (row as { id?: unknown }).id !== args.itemId
    ) {
      return null;
    }
  }
  return args.selectionBaseline?.sourceGeneration ?? null;
}

/**
 * Only the acknowledged text-promotion operation may advance source while
 * preserving its own selection. Ordinary source edits require reselection.
 * The caller supplies this operation's sent/returned generations, never a
 * generation merely observed on refetch. An older response cannot advance a
 * newer selection, and an ambiguous or non-successor result advances nothing.
 */
export function advanceSelectionAfterTextPromotion(
  baseline: SelectionSourceBaseline | null,
  acknowledgement: Readonly<{
    selectionKey: string;
    sentSourceGeneration: number;
    acceptedSourceGeneration: number;
    confirmed: boolean;
  }>,
): SelectionSourceBaseline | null {
  if (
    !baseline ||
    !acknowledgement.confirmed ||
    baseline.selectionKey !== acknowledgement.selectionKey ||
    baseline.sourceGeneration !== acknowledgement.sentSourceGeneration ||
    acknowledgement.acceptedSourceGeneration !==
      acknowledgement.sentSourceGeneration + 1
  )
    return baseline;
  return captureSelectionSourceBaseline(
    baseline.selectionKey,
    acknowledgement.acceptedSourceGeneration,
  );
}
