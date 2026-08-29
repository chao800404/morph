import type { SelectionKind } from "./selection-taxonomy";

export const PREVIEW_EMPTY_TEXT_LINE_ATTRIBUTE =
  "data-storefront-editor-empty-text-line";

const TEXT_SELECTION_KINDS = new Set<SelectionKind>([
  "heading",
  "paragraph",
  "text",
  "rich-text",
  "label",
  "blockquote",
  "code",
]);

type EmptyTextLineCandidate = Readonly<{
  kind: SelectionKind;
  content: string;
  inlineHeight: string;
  inlineMaxHeight: string;
}>;

export type PreviewEmptyTextElementCandidate = Readonly<{
  element: HTMLElement;
  kind: SelectionKind;
}>;

function isExplicitCssZero(value: string): boolean {
  return /^[-+]?(?:0*\.?0+)(?:[a-z%]+)?$/i.test(value.trim());
}

/**
 * Whether an editor-only blank line may safely participate in layout.
 *
 * This deliberately uses the DOM's real text instead of adding a sentinel to
 * it, so content reads and persisted overrides remain the authored empty
 * string. An explicitly collapsed inline box remains collapsed.
 */
export function shouldReservePreviewEmptyTextLine(
  input: EmptyTextLineCandidate,
): boolean {
  return (
    TEXT_SELECTION_KINDS.has(input.kind) &&
    input.content.trim().length === 0 &&
    !isExplicitCssZero(input.inlineHeight) &&
    !isExplicitCssZero(input.inlineMaxHeight)
  );
}

/**
 * Marks every currently empty editable text element in two phases: first read
 * all content/style state, then write attributes. The corresponding preview
 * CSS supplies a pseudo-element, leaving `textContent` untouched.
 */
export function syncPreviewEmptyTextLines(
  candidates: Iterable<PreviewEmptyTextElementCandidate>,
): boolean {
  const decisions = Array.from(candidates, ({ element, kind }) => ({
    element,
    reserve:
      element.style.display !== "none" &&
      shouldReservePreviewEmptyTextLine({
        kind,
        content: element.textContent ?? "",
        inlineHeight: element.style.height,
        inlineMaxHeight: element.style.maxHeight,
      }),
  }));
  let changed = false;

  for (const { element, reserve } of decisions) {
    if (element.hasAttribute(PREVIEW_EMPTY_TEXT_LINE_ATTRIBUTE) === reserve) {
      continue;
    }
    element.toggleAttribute(PREVIEW_EMPTY_TEXT_LINE_ATTRIBUTE, reserve);
    changed = true;
  }

  return changed;
}
