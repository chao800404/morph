import { describe, expect, it } from "vitest";
import {
  astroBasisAckVerdict,
  astroBasisBoundaryVerdict,
} from "./preview-dom";
import type { SectionPresentationToken } from "./preview-protocol";

/**
 * The bridge's half of the Astro basis ack (option B), as pure functions: the
 * frame acknowledges a basis token only on a page that navigates as
 * documents, rendered from the snapshot the token names, holding exactly one
 * well-formed `morph:s2` pair of the token's identity with this preview's
 * nonce. Everything else is `section-missing` with a cause.
 */

const NONCE = "0123456789abcdef";
const SRC = "a".repeat(64);
const IDENTITY = `${NONCE}:2:${SRC}:10:42`;
const OTHER = `${NONCE}:2:${SRC}:50:80`;
const INSTANCE = "0b1f5a52-3c1e-4f43-9d0e-6c0f2f1f9a11";

const open = (id: string, parent: unknown = "main") => ({
  text: `morph:s2 ${id}`,
  parent,
});
const close = (id: string, parent: unknown = "main") => ({
  text: `/morph:s2 ${id}`,
  parent,
});

describe("astroBasisBoundaryVerdict", () => {
  it("is applied for exactly one pair of the identity under one parent", () => {
    expect(
      astroBasisBoundaryVerdict(IDENTITY, NONCE, [
        open(OTHER),
        close(OTHER),
        open(IDENTITY),
        { text: "an author's comment", parent: "main" },
        close(IDENTITY),
      ]),
    ).toEqual({ applied: true });
  });

  it("is not applied with no pair, a duplicate, an unpaired or a split one", () => {
    const cases: Array<[string, Parameters<typeof astroBasisBoundaryVerdict>[2]]> =
      [
        ["no-boundary", []],
        ["no-boundary", [open(OTHER), close(OTHER)]],
        [
          "duplicate-boundary",
          [open(IDENTITY), close(IDENTITY), open(IDENTITY), close(IDENTITY)],
        ],
        ["unpaired-boundary", [open(IDENTITY)]],
        ["unpaired-boundary", [close(IDENTITY)]],
        ["unpaired-boundary", [close(IDENTITY), open(IDENTITY)]],
        ["split-boundary", [open(IDENTITY, "p"), close(IDENTITY, "div")]],
      ];
    for (const [cause, comments] of cases) {
      expect(
        astroBasisBoundaryVerdict(IDENTITY, NONCE, comments),
        JSON.stringify(comments),
      ).toEqual({ applied: false, cause });
    }
  });

  it("never counts markers of another nonce, and refuses an identity of another one", () => {
    const foreign = `fedcba9876543210:2:${SRC}:10:42`;
    expect(
      astroBasisBoundaryVerdict(IDENTITY, NONCE, [open(foreign), close(foreign)]),
    ).toEqual({ applied: false, cause: "no-boundary" });
    expect(
      astroBasisBoundaryVerdict(foreign, NONCE, [open(foreign), close(foreign)]),
    ).toEqual({ applied: false, cause: "wrong-nonce" });
    expect(
      astroBasisBoundaryVerdict(IDENTITY, null, [open(IDENTITY), close(IDENTITY)]),
    ).toEqual({ applied: false, cause: "wrong-nonce" });
  });

  it("does not read the old v1 format", () => {
    expect(
      astroBasisBoundaryVerdict(IDENTITY, NONCE, [
        { text: `morph:s ${IDENTITY}`, parent: "main" },
        { text: `/morph:s ${IDENTITY}`, parent: "main" },
      ]),
    ).toEqual({ applied: false, cause: "no-boundary" });
  });
});

describe("astroBasisAckVerdict", () => {
  const token: SectionPresentationToken = {
    workspaceKey: "storefront-1:theme-1",
    templateId: "template-1",
    routePath: "/",
    sectionId: "hero",
    documentBasis: { kind: "existing", draftGeneration: 3 },
    overlayRevision: 0,
    presentationRevision: 6,
    operationId: "section-basis-6",
    basis: {
      kind: "astro-boundary",
      identity: IDENTITY,
      servedContent: { ticket: 7, instance: INSTANCE },
    },
  };
  const page = {
    documentNavigation: true,
    nonce: NONCE,
    comments: [open(IDENTITY), close(IDENTITY)],
    servedContent: { ticket: 7, instance: INSTANCE },
  };

  it("is applied on the document the token names", () => {
    expect(astroBasisAckVerdict({ token, ...page })).toEqual({ applied: true });
  });

  it("never takes the boundary branch on a page that does not navigate as documents (Start)", () => {
    expect(
      astroBasisAckVerdict({ token, ...page, documentNavigation: false }),
    ).toEqual({ applied: false, cause: "not-document-navigation" });
  });

  it("is not applied without a basis, a stamp, or on another snapshot", () => {
    const { basis: _basis, ...start } = token;
    expect(astroBasisAckVerdict({ token: start, ...page })).toEqual({
      applied: false,
      cause: "no-basis",
    });
    expect(
      astroBasisAckVerdict({ token, ...page, servedContent: null }),
    ).toEqual({ applied: false, cause: "no-served-content" });
    expect(
      astroBasisAckVerdict({
        token,
        ...page,
        servedContent: { ticket: 6, instance: INSTANCE },
      }),
    ).toEqual({ applied: false, cause: "other-snapshot" });
    expect(
      astroBasisAckVerdict({
        token,
        ...page,
        servedContent: { ticket: 7, instance: "11111111-2222-3333-4444-555555555555" },
      }),
    ).toEqual({ applied: false, cause: "other-snapshot" });
  });

  it("passes the boundary's own cause on", () => {
    expect(
      astroBasisAckVerdict({ token, ...page, comments: [open(IDENTITY)] }),
    ).toEqual({ applied: false, cause: "unpaired-boundary" });
  });
});
