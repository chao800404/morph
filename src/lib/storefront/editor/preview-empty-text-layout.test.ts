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
