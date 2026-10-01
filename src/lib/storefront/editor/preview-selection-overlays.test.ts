// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  createPreviewSelectionOverlays,
  isPreviewEditorUiMutation,
} from "./preview-selection-overlays";

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

/**
 * What the structure observer may leave out when the Theme owns <body>: only
 * the overlays' own changes, recognised by identity, never by a marker.
 */
describe("telling the overlays' own changes from the Theme's", () => {
  beforeEach(() => {
    document.documentElement.replaceChild(
      document.createElement("body"),
      document.body,
    );
  });

  /** Runs `change` under an observer like the bridge's and returns the records. */
  async function recordsOf(change: () => void) {
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((batch) => records.push(...batch));
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    change();
    await Promise.resolve();
    records.push(...observer.takeRecords());
    observer.disconnect();
    return records;
  }

  it("leaves out a change inside an overlay, such as its label", async () => {
    const overlays = createPreviewSelectionOverlays();
    const label = ringsInDocument()[0]!.querySelector("span")!;
    const records = await recordsOf(() => {
      label.textContent = "Heading";
      ringsInDocument()[0]!.style.top = "12px";
    });
    expect(records.length).toBeGreaterThan(0);
    expect(
      records.every((record) =>
        isPreviewEditorUiMutation(record, overlays.owns),
      ),
    ).toBe(true);
  });

  it("leaves out an overlay being put back into a replaced body", async () => {
    const overlays = createPreviewSelectionOverlays();
    const [first] = ringsInDocument();
    const records = await recordsOf(() => {
      first!.remove();
      document.body.appendChild(first!);
    });
    expect(records.length).toBeGreaterThan(0);
    expect(
      records.every((record) =>
        isPreviewEditorUiMutation(record, overlays.owns),
      ),
    ).toBe(true);
  });

  it("keeps a Theme node added to or removed from the body", async () => {
    const overlays = createPreviewSelectionOverlays();
    const section = document.createElement("section");
    const added = await recordsOf(() => document.body.appendChild(section));
    const removed = await recordsOf(() => section.remove());
    for (const record of [...added, ...removed]) {
      expect(isPreviewEditorUiMutation(record, overlays.owns)).toBe(false);
    }
  });

  it("keeps a change of a Theme element's attributes or text", async () => {
    const overlays = createPreviewSelectionOverlays();
    const heading = document.createElement("h1");
    heading.textContent = "Before";
    document.body.appendChild(heading);
    const records = await recordsOf(() => {
      heading.setAttribute("data-storefront-field", "heading");
      heading.className = "text-xl";
      heading.firstChild!.textContent = "After";
    });
    expect(records.length).toBe(3);
    for (const record of records) {
      expect(isPreviewEditorUiMutation(record, overlays.owns)).toBe(false);
    }
  });

  it("keeps a change that adds a Theme node together with an overlay", async () => {
    const overlays = createPreviewSelectionOverlays();
    const [first] = ringsInDocument();
    first!.remove();
    const both = document.createDocumentFragment();
    both.append(first!, document.createElement("main"));
    const records = await recordsOf(() => document.body.appendChild(both));
    expect(records).toHaveLength(1);
    expect(isPreviewEditorUiMutation(records[0]!, overlays.owns)).toBe(false);
  });

  it("does not trust a marker: a Theme element dressed as editor UI is still the Theme's", async () => {
    const overlays = createPreviewSelectionOverlays();
    const disguised = document.createElement("div");
    disguised.setAttribute("aria-hidden", "true");
    disguised.setAttribute("data-morph-editor-ui", "");
    disguised.style.position = "fixed";
    const records = await recordsOf(() => document.body.appendChild(disguised));
    expect(records).toHaveLength(1);
    expect(isPreviewEditorUiMutation(records[0]!, overlays.owns)).toBe(false);
  });
});
