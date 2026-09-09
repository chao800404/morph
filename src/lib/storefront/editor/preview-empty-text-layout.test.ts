// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import type { SelectionKind } from "./selection-taxonomy";
import {
  PREVIEW_EMPTY_TEXT_LINE_ATTRIBUTE,
  shouldReservePreviewEmptyTextLine,
  syncPreviewEmptyTextLines,
} from "./preview-empty-text-layout";

function candidate(element: HTMLElement, kind: SelectionKind = "paragraph") {
  return { element, kind };
}

describe("preview empty text layout", () => {
  it("marks empty text without changing its content value", () => {
    const paragraph = document.createElement("p");

    expect(syncPreviewEmptyTextLines([candidate(paragraph)])).toBe(true);
    expect(paragraph.hasAttribute(PREVIEW_EMPTY_TEXT_LINE_ATTRIBUTE)).toBe(
      true,
    );
    expect(paragraph.textContent).toBe("");
    expect(paragraph.childNodes).toHaveLength(0);
    expect(syncPreviewEmptyTextLines([candidate(paragraph)])).toBe(false);
  });

  it("keeps authored whitespace intact while reserving its line", () => {
    const heading = document.createElement("h1");
    heading.textContent = "  \n";

    syncPreviewEmptyTextLines([candidate(heading, "heading")]);

    expect(heading.hasAttribute(PREVIEW_EMPTY_TEXT_LINE_ATTRIBUTE)).toBe(true);
    expect(heading.textContent).toBe("  \n");
  });

  it("removes a stale marker after content is rendered", () => {
    const paragraph = document.createElement("p");
    syncPreviewEmptyTextLines([candidate(paragraph)]);
    paragraph.textContent = "Rendered copy";

    expect(syncPreviewEmptyTextLines([candidate(paragraph)])).toBe(true);
    expect(paragraph.hasAttribute(PREVIEW_EMPTY_TEXT_LINE_ATTRIBUTE)).toBe(
      false,
    );
    expect(paragraph.textContent).toBe("Rendered copy");
  });

  it("does not mark non-text elements or explicitly collapsed inline boxes", () => {
    const container = document.createElement("div");
    const hidden = document.createElement("p");
    const zeroHeight = document.createElement("p");
    const zeroMaxHeight = document.createElement("p");
    hidden.style.display = "none";
    zeroHeight.style.height = "0px";
    zeroMaxHeight.style.maxHeight = "0";

    syncPreviewEmptyTextLines([
      candidate(container, "container"),
      candidate(hidden),
      candidate(zeroHeight),
      candidate(zeroMaxHeight),
    ]);

    for (const element of [container, hidden, zeroHeight, zeroMaxHeight]) {
      expect(element.hasAttribute(PREVIEW_EMPTY_TEXT_LINE_ATTRIBUTE)).toBe(
        false,
      );
    }
  });

  it("recognizes all supported text selection kinds", () => {
    for (const kind of [
      "heading",
      "paragraph",
      "text",
      "rich-text",
      "label",
      "blockquote",
      "code",
    ] as const) {
      expect(
        shouldReservePreviewEmptyTextLine({
          kind,
          content: "",
          inlineHeight: "",
          inlineMaxHeight: "",
        }),
      ).toBe(true);
    }
  });
});

describe("a cleared content field keeps a line to be clicked on", () => {
  /**
   * An element with no height cannot be selected, so emptying a field on a tag
   * the old list did not name — a store name in a `<span>`, a menu entry in an
   * `<a>` — made that field unreachable from the canvas afterwards.
   */
  function field(tag: string): HTMLElement {
    const element = document.createElement(tag);
    element.setAttribute("data-storefront-field", "label");
    return element;
  }

  it("reserves a line for an emptied link", () => {
    const anchor = field("a");

    syncPreviewEmptyTextLines([{ element: anchor, kind: "link" }]);

    expect(anchor.hasAttribute(PREVIEW_EMPTY_TEXT_LINE_ATTRIBUTE)).toBe(true);
  });

  it("reserves a line for an emptied span the taxonomy calls custom", () => {
    const span = field("span");

    syncPreviewEmptyTextLines([{ element: span, kind: "custom" }]);

    expect(span.hasAttribute(PREVIEW_EMPTY_TEXT_LINE_ATTRIBUTE)).toBe(true);
  });

  it("leaves a link that renders something other than text alone", () => {
    // An anchor around an image has no text either, and it is already visible.
    const anchor = field("a");
    anchor.appendChild(document.createElement("img"));

    syncPreviewEmptyTextLines([{ element: anchor, kind: "link" }]);

    expect(anchor.hasAttribute(PREVIEW_EMPTY_TEXT_LINE_ATTRIBUTE)).toBe(false);
  });

  it("leaves an element that is not a content field alone", () => {
    const anchor = document.createElement("a");

    syncPreviewEmptyTextLines([{ element: anchor, kind: "link" }]);

    expect(anchor.hasAttribute(PREVIEW_EMPTY_TEXT_LINE_ATTRIBUTE)).toBe(false);
  });

  it("still honours an explicitly collapsed box", () => {
    const anchor = field("a");
    anchor.style.height = "0px";

    syncPreviewEmptyTextLines([{ element: anchor, kind: "link" }]);

    expect(anchor.hasAttribute(PREVIEW_EMPTY_TEXT_LINE_ATTRIBUTE)).toBe(false);
  });

  it("drops the line once the field has content again", () => {
    const anchor = field("a");
    syncPreviewEmptyTextLines([{ element: anchor, kind: "link" }]);
    anchor.textContent = "Shop";

    syncPreviewEmptyTextLines([{ element: anchor, kind: "link" }]);

    expect(anchor.hasAttribute(PREVIEW_EMPTY_TEXT_LINE_ATTRIBUTE)).toBe(false);
  });
});
