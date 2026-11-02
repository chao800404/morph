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
  /**
   * Whether this element is bound to a content field the author can clear.
   *
   * The tag list below was a proxy for "this element's content is its text",
   * and it only ever listed the tags a starter happened to use. A store name
   * in a `<span>` and a menu entry in an `<a>` are just as clearable and just
   * as invisible once cleared — and an element with no height cannot be
   * clicked, so the author could empty a field and then never reach it again.
   */
  isContentField?: boolean;
  /** Whether the element renders anything other than its own text. */
  hasElementChildren?: boolean;
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
  // A field-bound element earns a line only when text is all it renders. An
  // anchor around an image has no text either, and giving that one a blank
  // line would add height to something already perfectly visible.
  const rendersTextAlone =
    input.isContentField === true && input.hasElementChildren !== true;
  return (
    (TEXT_SELECTION_KINDS.has(input.kind) || rendersTextAlone) &&
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
        isContentField: element.hasAttribute("data-storefront-field"),
        hasElementChildren: element.childElementCount > 0,
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
