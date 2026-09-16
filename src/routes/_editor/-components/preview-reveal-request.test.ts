import { describe, expect, it } from "vitest";
import { shouldRevealPreviewSelection } from "./preview-reveal-request";

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
