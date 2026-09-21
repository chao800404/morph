import { describe, expect, it } from "vitest";

import {
  containedFamilies,
  FAMILY_CONTAINS,
  type PatchablePropertyFamily,
} from "./inspector-family-containment";

/**
 * The containment **relation** only: which families does a family decide?
 *
 * The policy built on it — what the Inspector actually does to a class string —
 * is tested in `inspector-family-edit.test.ts`, against the real
 * `patchBroadFamily` that the component calls.
 *
 * That split is the point of this file's shape. It previously contained a local
 * `sweepUp` helper that **mirrored** the component's nesting by hand, so it
 * stayed green even if the component stopped using this relation entirely: a
 * mirror tests a copy. The relation is asserted here; the behaviour is asserted
 * there.
 */

describe("containedFamilies", () => {
  it("returns every family a broad family decides, transitively", () => {
    expect(new Set(containedFamilies("padding"))).toEqual(
      new Set([
        "padding-x",
        "padding-y",
        "padding-top",
        "padding-right",
        "padding-bottom",
        "padding-left",
        "padding-inline-start",
        "padding-inline-end",
      ]),
    );
    expect(new Set(containedFamilies("margin"))).toEqual(
      new Set([
        "margin-x",
        "margin-y",
        "margin-top",
        "margin-right",
        "margin-bottom",
        "margin-left",
        "margin-inline-start",
        "margin-inline-end",
      ]),
    );
  });

  it("reaches the physical sides through the x/y rank, not only directly", () => {
    // The read path already ranks padding above padding-x above padding-left.
    // If this returned only the direct edges, a surviving `px-*` would keep
    // deciding the inline sides. The two logical inline sides come along because
    // `padding-inline` is their shorthand — the logical-edge test below is about
    // why that needs no writing-mode assumption.
    expect(new Set(containedFamilies("padding-x"))).toEqual(
      new Set([
        "padding-left",
        "padding-right",
        "padding-inline-start",
        "padding-inline-end",
      ]),
    );
    expect(new Set(containedFamilies("padding-y"))).toEqual(
      new Set(["padding-top", "padding-bottom"]),
    );
  });

  it("reaches the physical sides through the axis ranks, for border as for padding", () => {
    // The same rank padding has, applied to the second family that needs it.
    // `border-x-*` is `border-inline-width`, so it decides left and right **and**
    // the two logical inline sides; `border-y-*` is `border-block-width`,
    // deciding top and bottom.
    expect(new Set(containedFamilies("border-width-x"))).toEqual(
      new Set([
        "border-width-left",
        "border-width-right",
        "border-width-inline-start",
        "border-width-inline-end",
      ]),
    );
    expect(new Set(containedFamilies("border-width-y"))).toEqual(
      new Set(["border-width-top", "border-width-bottom"]),
    );
  });

  it("makes the radius side pairs a lattice, not a chain", () => {
    // `rounded-t` covers two corners and `rounded-l` covers two others, so a
    // corner has **two parents**. This is what makes the traversal a graph walk
    // with a visited set rather than a descent down a tree: every corner is
    // reachable from `border-radius` by two routes, and the result must list each
    // one exactly once.
    expect(new Set(containedFamilies("border-radius-top"))).toEqual(
      new Set(["border-radius-top-left", "border-radius-top-right"]),
    );
    const fromBroad = containedFamilies("border-radius");
    expect(new Set(fromBroad).size).toBe(fromBroad.length);
    expect(new Set(fromBroad)).toEqual(
      new Set([
        "border-radius-top",
        "border-radius-right",
        "border-radius-bottom",
        "border-radius-left",
        "border-radius-top-left",
        "border-radius-top-right",
        "border-radius-bottom-right",
        "border-radius-bottom-left",
        "border-radius-start",
        "border-radius-end",
        "border-radius-start-start",
        "border-radius-start-end",
        "border-radius-end-start",
        "border-radius-end-end",
      ]),
    );
  });

  it("reaches the logical inline sides through the broad family and the axis rank", () => {
    // These edges need **no writing-mode assumption**, unlike the physical ones:
    // `padding-inline` *is* the shorthand for the two logical inline sides, so it
    // determines them in every writing mode, and `padding` sets all four physical
    // sides — one of which a logical side always resolves to. The same argument
    // holds for `margin`, `border-width` and the radius corners.
    expect(containedFamilies("padding")).toContain("padding-inline-start");
    expect(containedFamilies("margin")).toContain("margin-inline-end");
    expect(containedFamilies("border-width")).toContain(
      "border-width-inline-start",
    );
    expect(containedFamilies("border-width-x")).toContain(
      "border-width-inline-end",
    );
    // `rounded-s` covers the two start corners, `rounded-e` the two end corners —
    // a logical side pair over a logical axis, so the same shape as `rounded-t`
    // but without its assumption.
    expect(new Set(containedFamilies("border-radius-start"))).toEqual(
      new Set(["border-radius-start-start", "border-radius-end-start"]),
    );
    expect(new Set(containedFamilies("border-radius-end"))).toEqual(
      new Set(["border-radius-start-end", "border-radius-end-end"]),
    );
  });

  it("returns nothing for a family outside every group", () => {
    expect(containedFamilies("font-size")).toEqual([]);
    expect(containedFamilies("opacity")).toEqual([]);
  });

  it("never contains the family it was asked about", () => {
    for (const family of Object.keys(FAMILY_CONTAINS)) {
      expect(
        containedFamilies(family as PatchablePropertyFamily),
      ).not.toContain(family);
    }
  });
});

describe("the relation is directional", () => {
  /**
   * `padding` contains `padding-left`, not the reverse. That direction is what
   * separates "the user set the broad family, so narrower overrides must go" —
   * implemented — from "the user set a narrow family, so the broad one may need
   * decomposing" — not implemented, and the decision the containment work is
   * still waiting on.
   */
  it("does not treat a narrow family as containing its broad family", () => {
    expect(containedFamilies("padding-left")).toEqual([]);
    expect(containedFamilies("padding-right")).toEqual([]);
    expect(containedFamilies("border-radius-top-left")).toEqual([]);
  });
});
