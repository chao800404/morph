const MAX_SELECTION_CONTENT_LENGTH = 10_000;

/**
 * Reads the user-editable value represented by a selected preview element.
 *
 * Form controls keep their rendered value in the `value` property rather than
 * in text nodes. Other elements continue to expose their content through
 * `textContent`.
 */
export function readSelectionContentValue(
  element: HTMLElement | HTMLSelectElement,
): string {
  const tagName = element.tagName.toLowerCase();
  const content =
    tagName === "input" || tagName === "textarea" || tagName === "select"
      ? (element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement)
          .value
      : tagName === "img" || tagName === "video" || tagName === "audio"
        ? (element.getAttribute("src") ?? "")
        : (element.textContent ?? "");

  return content.slice(0, MAX_SELECTION_CONTENT_LENGTH);
}
