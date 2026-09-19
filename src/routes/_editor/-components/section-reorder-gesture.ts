/**
 * What a section drag should do, decided apart from the gesture that drives it.
 *
 * The reorder is a drag: `onDragOver` fires continuously while the pointer
 * moves and `onDragEnd` fires once. The rule the editor depends on is that the
 * first of those never reaches the server and the second reaches it at most
 * once — a persistent write per pointer event is the defect the eleventh round
 * found in the panel resize, and this is the same shape one component over.
 *
 * That rule lived inside two inline handlers on a dnd-kit provider, where the
 * only way to test it was to drive dnd-kit in jsdom. Extracted, the decisions
 * are ordinary functions: they say what should happen and the panel does it, so
 * "a drag in flight does not commit" is a thing a test can state rather than a
 * thing a reviewer has to notice.
 *
 * Deliberately not a hook. There is no state here — the working order lives in
 * the panel, because that is what dnd-kit renders from.
 */

export type ReorderableSection = { id: string };

/** Moves one item, returning the original array when the move is a no-op. */
export function moveSection<T extends ReorderableSection>(
  items: readonly T[],
  from: number,
  to: number,
): readonly T[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (!moved) return items;
  next.splice(to, 0, moved);
  return next;
}

/**
 * The working order a drag-over should produce, or `null` to leave it alone.
 *
 * `null` for every case that is not a real move: no source or target, a drop on
 * itself, an id the current order does not hold, or a pending write. Returning
 * the array unchanged instead would make the panel re-render on every pointer
 * event that resolved to the same position, which is the cost this gesture is
 * most exposed to.
 */
export function planSectionDragOver<T extends ReorderableSection>(options: {
  sections: readonly T[];
  sourceId: string | number | null | undefined;
  targetId: string | number | null | undefined;
  busy: boolean;
}): readonly T[] | null {
  const { sections, sourceId, targetId, busy } = options;
  if (busy) return null;
  if (sourceId == null || targetId == null) return null;
  if (sourceId === targetId) return null;

  const from = sections.findIndex((section) => section.id === sourceId);
  const to = sections.findIndex((section) => section.id === targetId);
  if (from < 0 || to < 0 || from === to) return null;

  return moveSection(sections, from, to);
}

/**
 * What the end of a drag should do.
 *
 * `commit` carries the ids rather than the sections, because that is what the
 * server is told and comparing ids is what decides whether there is anything to
 * tell. A drag that was dragged and put back where it started is not an edit.
 */
export type SectionDragEndPlan<T extends ReorderableSection> =
  | { kind: "commit"; ids: string[] }
  | { kind: "restore"; sections: readonly T[] }
  | { kind: "none" };

export function planSectionDragEnd<T extends ReorderableSection>(options: {
  /** The order as it was when the drag began; `null` if nothing began. */
  initial: readonly T[] | null;
  /** The working order the drag-overs built up. */
  next: readonly T[];
  canceled: boolean;
  busy: boolean;
}): SectionDragEndPlan<T> {
  const { initial, next, canceled, busy } = options;
  if (!initial || busy) return { kind: "none" };
  if (canceled) return { kind: "restore", sections: initial };

  const initialIds = initial.map((section) => section.id);
  const nextIds = next.map((section) => section.id);
  const unchanged =
    initialIds.length === nextIds.length &&
    initialIds.every((id, index) => id === nextIds[index]);

  return unchanged ? { kind: "none" } : { kind: "commit", ids: nextIds };
}
