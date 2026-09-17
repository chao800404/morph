import { describe, expect, it } from "vitest";
import type { PreviewSelectionRestoreTarget } from "@/lib/storefront/editor/preview-protocol";
import {
  createSelectionRestoreMessages,
  isPreviewSelectionReportStale,
  shouldRevealPreviewSelection,
  shouldSkipStalePreviewSectionSync,
} from "./preview-reveal-request";

const request = {
  revision: 42,
  reveal: true,
  previewKey: "preview-1",
};

const answer = (
  overrides: Partial<Parameters<typeof shouldRevealPreviewSelection>[0]> = {},
) =>
  shouldRevealPreviewSelection({
    request,
    responseRevision: 42,
    previewKey: "preview-1",
    targetMatches: true,
    ...overrides,
  });

describe("deciding whether a report may move the canvas", () => {
  it("moves it for the answer to the request that asked", () => {
    expect(answer()).toBe(true);
  });

  // The canvas is where the author already is. Moving it under a click is how
  // a click comes to feel like a misfire.
  it("stays still for a selection made on the canvas", () => {
    expect(answer({ request: { revision: 42 } })).toBe(false);
    expect(answer({ request: null })).toBe(false);
  });

  /**
   * Two rows clicked quickly. The first reply arrives against a revision that
   * has already been passed, and is an answer to a request nobody is waiting
   * for any more.
   */
  it("ignores a reply to a request that was superseded", () => {
    expect(answer({ responseRevision: 41 })).toBe(false);
  });

  /**
   * The preview keeps its own counter and adopts the higher of the two, so a
   * request made while it is ahead comes back with a number larger than the one
   * asked for. That is the answer, not a different selection — which is why the
   * target has to match and does the work of telling them apart. Requiring
   * equality here refused the first selection of every session.
   */
  it("accepts an answer the preview numbered higher", () => {
    expect(answer({ responseRevision: 43 })).toBe(true);
    expect(answer({ responseRevision: 43, targetMatches: false })).toBe(false);
  });

  /**
   * A canvas click landing between the request and its reply. It reports a
   * different element, so the target does not match what was asked for.
   */
  it("stays still when the report names something else", () => {
    expect(answer({ targetMatches: false })).toBe(false);
  });

  // A reconnect mints a new preview; anything outstanding against the old one
  // describes a document that is no longer on screen.
  it("stays still when the preview has been replaced", () => {
    expect(answer({ previewKey: "preview-2" })).toBe(false);
  });

  // A request made before the preview had a key is not tied to one, and the
  // revision and target still have to agree.
  it("allows a request that names no preview", () => {
    expect(
      answer({
        request: { revision: 42, reveal: true },
        previewKey: "preview-9",
      }),
    ).toBe(true);
  });
});

describe("deciding whether a report has been overtaken", () => {
  /**
   * The sequence that broke the first tree click of every session, played in
   * order: the click asks for a selection, the mode sync runs straight after it
   * because that click is what turned selection mode on, and then the preview
   * answers the click.
   */
  it("keeps the answer to a request a re-assertion followed", () => {
    let latest = 3;
    const askForSelection = () => (latest += 1);
    const reassertSelectionMode = () => latest;

    const asked = askForSelection();
    reassertSelectionMode();

    expect(
      isPreviewSelectionReportStale({
        responseRevision: asked,
        latestSelectionRevision: latest,
      }),
    ).toBe(false);
  });

  /**
   * The same sequence with the mode sync taking a number of its own, which is
   * what the shell used to do. The click is answered and the answer is thrown
   * away — kept here so the difference is a failing test rather than a comment.
   */
  it("would discard it had the re-assertion taken a number", () => {
    let latest = 3;
    const asked = (latest += 1);
    latest += 1;

    expect(
      isPreviewSelectionReportStale({
        responseRevision: asked,
        latestSelectionRevision: latest,
      }),
    ).toBe(true);
  });

  it("still discards a report the author has moved on from", () => {
    expect(
      isPreviewSelectionReportStale({
        responseRevision: 4,
        latestSelectionRevision: 7,
      }),
    ).toBe(true);
  });

  it("keeps a report numbered above the latest request", () => {
    expect(
      isPreviewSelectionReportStale({
        responseRevision: 9,
        latestSelectionRevision: 7,
      }),
    ).toBe(false);
  });
});

describe("a section sync that would replace a waiting selection", () => {
  it("ignores a stale section effect while another tree target is pending", () => {
    const pendingTarget = {
      sectionId: "category-showcase",
      sourceLocation: "CategoryShowcase.tsx:41:7",
      isSection: false,
    } satisfies PreviewSelectionRestoreTarget;

    expect(shouldSkipStalePreviewSectionSync("hero", pendingTarget)).toBe(true);
    expect(
      shouldSkipStalePreviewSectionSync("category-showcase", pendingTarget),
    ).toBe(false);
    expect(shouldSkipStalePreviewSectionSync("hero", null)).toBe(false);
  });

  it("posts selection mode restore followed by style refresh without remounting the preview", () => {
    const target = {
      sectionId: "hero",
      nodeId: "hero-heading",
      fieldPath: "heading",
      elementKey: "heading",
      fieldKey: "heading",
      isSection: false,
    } as const;

    expect(createSelectionRestoreMessages(true, target)).toEqual([
      {
        type: "morph:storefront-preview-set-selection-mode",
        enabled: true,
        restoreTarget: target,
      },
      { type: "morph:storefront-preview-request-selection-style" },
    ]);
    expect(createSelectionRestoreMessages(false, target)).toEqual([
      {
        type: "morph:storefront-preview-set-selection-mode",
        enabled: false,
        restoreTarget: undefined,
      },
    ]);
  });

  it("carries the latest selection revision through a restore request", () => {
    const target = {
      sectionId: "hero",
      elementKey: "hero-image",
      isSection: false,
    } as const;

    expect(createSelectionRestoreMessages(true, target, 4)[0]).toMatchObject({
      type: "morph:storefront-preview-set-selection-mode",
      selectionRevision: 4,
    });
  });
});
