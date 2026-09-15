// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { createPreviewSelectionOverlays } from "./preview-selection-overlays";

/** The rings: fixed, aria-hidden, and above everything the Theme can reach. */
const ringsInDocument = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>("div[aria-hidden='true']"),
  ).filter((element) => element.style.position === "fixed");

describe("the selection rings and the body they live in", () => {
  // One document per file, so each test starts from a body of its own.
  beforeEach(() => {
    document.documentElement.replaceChild(
      document.createElement("body"),
      document.body,
    );
  });

  it("puts them in the document it was created in", () => {
    createPreviewSelectionOverlays();
    expect(ringsInDocument()).toHaveLength(2);
  });

  /**
   * A Theme that owns its document shell is mounted on the document, so React
   * replaces `<body>` on its first commit. The rings were appended to the body
   * that existed when the bridge loaded: every one of them went on being drawn
   * correctly, into a tree nobody could see. Selection still worked, and looked
   * to the author exactly like it had stopped.
   */
  it("follows the body when React replaces it", () => {
    const overlays = createPreviewSelectionOverlays();
    expect(ringsInDocument()).toHaveLength(2);

    document.documentElement.replaceChild(
      document.createElement("body"),
      document.body,
    );
    expect(ringsInDocument()).toHaveLength(0);

    // Positioning is the one moment it matters, and the only one that runs on
    // every commit that could have moved them.
    overlays.position({
      enabled: true,
      selected: null,
      hovered: null,
      selectedFrozen: false,
      inlineEditing: false,
    });
    expect(ringsInDocument()).toHaveLength(2);
  });

  it("does not add a second pair when the body is untouched", () => {
    const overlays = createPreviewSelectionOverlays();
    for (let index = 0; index < 3; index += 1) {
      overlays.position({
        enabled: true,
        selected: null,
        hovered: null,
        selectedFrozen: false,
        inlineEditing: false,
      });
    }
    expect(ringsInDocument()).toHaveLength(2);
  });
});
