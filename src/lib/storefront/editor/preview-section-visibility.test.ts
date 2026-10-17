import { describe, expect, it } from "vitest";
import type { ContentSnapshot } from "./content-write-snapshot";
import type { PendingContentEntry } from "./pending-content-write";
import {
  previewSectionHidden,
  previewSectionPost,
} from "./preview-instance-content";

/**
 * V(S), the visibility the editor holds for one section, read from the refs
 * it already keeps and nothing else (design v2, "Visibility model"):
 *
 *   V(S) = hidden ⇔ Intent = hide ∨ (H-confirmed ∧ Intent ≠ show)
 *
 * H-confirmed is the accepted copy holding the section `enabled: false`.
 * Intent is the pending entry's `enabled` — refused or not — else the
 * unconfirmed entry's, else none. Unlike the replay's own composition, an
 * unanswered hide and a refused hide both count as the hide.
 */

const SECTION = "hero";
const snapshot = (enabled: boolean | undefined): ContentSnapshot => ({
  draftGeneration: 3,
  ownSince: 3,
  sections: [
    {
      id: SECTION,
      ...(enabled === undefined ? {} : { enabled }),
      props: { heading: "Stored heading", subheading: "Stored sub" },
    },
  ],
});
const enabledEntry = (
  enabled: boolean,
  options: { rejected?: boolean; sourceGeneration?: number } = {},
): PendingContentEntry => ({
  sectionId: SECTION,
  props: { enabled },
  fields: {
    enabled: {
      value: enabled,
      sourceGeneration: options.sourceGeneration ?? 1,
      ...(options.rejected ? { rejected: true } : {}),
    },
  },
});
const headingEntry: PendingContentEntry = {
  sectionId: SECTION,
  props: { heading: "Typed" },
  fields: { heading: { value: "Typed", sourceGeneration: 1 } },
};

const hidden = (args: {
  snapshot?: ContentSnapshot;
  pending?: PendingContentEntry;
  unconfirmed?: PendingContentEntry;
}) =>
  previewSectionHidden({
    snapshot: args.snapshot,
    sectionId: SECTION,
    pending: args.pending,
    unconfirmed: args.unconfirmed,
  });

describe("U1: the visibility truth table", () => {
  it("accepted hidden with no intent is hidden", () => {
    expect(hidden({ snapshot: snapshot(false) })).toBe(true);
    // A pending edit that says nothing about visibility is no intent.
    expect(hidden({ snapshot: snapshot(false), pending: headingEntry })).toBe(
      true,
    );
  });

  it("a pending show over an accepted hide is shown", () => {
    expect(
      hidden({ snapshot: snapshot(false), pending: enabledEntry(true) }),
    ).toBe(false);
  });

  it("an unconfirmed hide over an accepted show is hidden", () => {
    const sent = enabledEntry(false);
    // The entry still pending is the very one that was sent.
    expect(
      hidden({ snapshot: snapshot(true), pending: sent, unconfirmed: sent }),
    ).toBe(true);
    // Only the unanswered write holds it.
    expect(hidden({ snapshot: snapshot(true), unconfirmed: sent })).toBe(true);
    // A pending entry with no visibility of its own defers to it.
    expect(
      hidden({
        snapshot: snapshot(true),
        pending: headingEntry,
        unconfirmed: sent,
      }),
    ).toBe(true);
  });

  it("a refused pending hide over an accepted show is hidden", () => {
    expect(
      hidden({
        snapshot: snapshot(true),
        pending: enabledEntry(false, { rejected: true }),
      }),
    ).toBe(true);
  });

  it("everything else is shown", () => {
    expect(hidden({})).toBe(false);
    expect(hidden({ snapshot: snapshot(true) })).toBe(false);
    expect(hidden({ snapshot: snapshot(undefined) })).toBe(false);
    expect(hidden({ snapshot: snapshot(true), pending: headingEntry })).toBe(
      false,
    );
    // The pending entry decides before the unconfirmed one.
    expect(
      hidden({
        snapshot: snapshot(true),
        pending: enabledEntry(true),
        unconfirmed: enabledEntry(false),
      }),
    ).toBe(false);
  });

  it("reads an entry with no per-field record by its props", () => {
    expect(
      hidden({
        snapshot: snapshot(true),
        pending: { sectionId: SECTION, props: { enabled: false } },
      }),
    ).toBe(true);
  });
});

describe("U2: the composed post", () => {
  it("a hidden section is composed with no props at all", () => {
    for (const args of [
      { snapshot: snapshot(false) },
      { snapshot: snapshot(true), pending: enabledEntry(false) },
      {
        snapshot: snapshot(true),
        pending: enabledEntry(false, { rejected: true }),
      },
      { snapshot: snapshot(true), unconfirmed: enabledEntry(false) },
    ]) {
      const post = previewSectionPost({
        sectionId: SECTION,
        pending: undefined,
        unconfirmed: undefined,
        sourceGeneration: 1,
        ...args,
      });
      expect(post).toEqual({ props: undefined, enabled: false });
      expect(post!.props).toBeUndefined();
    }
  });

  it("a shown section is composed from the accepted copy and the pending fields, shown", () => {
    expect(
      previewSectionPost({
        snapshot: snapshot(false),
        sectionId: SECTION,
        pending: {
          sectionId: SECTION,
          props: { enabled: true, heading: "Typed" },
          fields: {
            enabled: { value: true, sourceGeneration: 1 },
            heading: { value: "Typed", sourceGeneration: 1 },
          },
        },
        unconfirmed: undefined,
        sourceGeneration: 1,
      }),
    ).toEqual({
      props: { heading: "Typed", subheading: "Stored sub" },
      enabled: true,
    });
  });

  it("composes nothing for a section nothing describes", () => {
    expect(
      previewSectionPost({
        snapshot: undefined,
        sectionId: SECTION,
        pending: undefined,
        unconfirmed: undefined,
        sourceGeneration: 1,
      }),
    ).toBeNull();
  });
});
