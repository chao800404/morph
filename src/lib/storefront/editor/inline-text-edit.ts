import type { SelectionKind } from "./selection-taxonomy";

export const INLINE_TEXT_EDIT_MAX_LENGTH = 10_000;

const INLINE_TEXT_SELECTION_KINDS = new Set<SelectionKind>([
  "heading",
  "paragraph",
  "text",
  "rich-text",
  "label",
  "blockquote",
  "code",
]);

export type InlineTextEditCandidate = Readonly<{
  selectionEnabled: boolean;
  kind: SelectionKind;
  sectionId: string | null;
  fieldKey: string | null;
  fieldPath: string | null;
  descendantFieldCount: number;
  isSection: boolean;
}>;

export function isInlineTextSelectionKind(kind: SelectionKind): boolean {
  return INLINE_TEXT_SELECTION_KINDS.has(kind);
}

/**
 * Inline authoring is intentionally narrower than ordinary selection. A node
 * must map one text box to one persisted Document field; aggregate containers
 * and source-only elements are still selectable, but cannot pretend to save.
 */
export function isInlineTextEditCandidate(
  candidate: InlineTextEditCandidate,
): boolean {
  return (
    candidate.selectionEnabled &&
    isInlineTextSelectionKind(candidate.kind) &&
    Boolean(candidate.sectionId) &&
    Boolean(candidate.fieldKey) &&
    Boolean(candidate.fieldPath) &&
    candidate.descendantFieldCount === 0 &&
    !candidate.isSection
  );
}

export function hasInlineTextDocumentTarget(
  sectionId: string,
  documentSectionIds: Iterable<string>,
  routeSlotIds: Iterable<string>,
): boolean {
  return (
    Array.from(documentSectionIds).includes(sectionId) ||
    Array.from(routeSlotIds).includes(sectionId)
  );
}

/** Converts the editable DOM back to the bounded plain-text wire contract. */
export function normalizeInlineTextEditValue(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .slice(0, INLINE_TEXT_EDIT_MAX_LENGTH);
}

export function shouldNormalizeInlineTextInput(
  compositionActive: boolean,
  inputEventIsComposing: boolean,
): boolean {
  return !compositionActive && !inputEventIsComposing;
}
