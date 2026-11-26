import { afterEach, describe, expect, it } from "vitest";
import {
  astroBasisAckVerdict,
  astroBasisBoundaryVerdict,
} from "./preview-dom";
import type { SectionPresentationToken } from "./preview-protocol";

/**
 * The bridge's half of the Astro basis ack (option B): the frame acknowledges
 * a basis token only on a page that navigates as documents, rendered from the
 * snapshot the token names, holding exactly one `morph:s2` pair of the
 * token's identity with this preview's nonce that the selection rule would
 * still call selectable (paired under one parent, nested cleanly, enclosing
 * an element). Everything else is `section-missing` with a cause.
 *
 * Read on a real document, as the bridge reads it: the boundary rule walks
 * siblings and the document's comments, so a list of comments cannot say
 * whether another boundary crosses this one or whether it is empty.
 */

const NONCE = "0123456789abcdef";
const SRC = "a".repeat(64);
const IDENTITY = `${NONCE}:2:${SRC}:10:42`;
const OTHER = `${NONCE}:2:${SRC}:50:80`;
const INSTANCE = "0b1f5a52-3c1e-4f43-9d0e-6c0f2f1f9a11";

const open = (id: string) => `<!--morph:s2 ${id}-->`;
const close = (id: string) => `<!--/morph:s2 ${id}-->`;
/** The document with `html` as its body, as the frame holds it. */
const page = (html: string) => {
  document.body.innerHTML = html;
  return document;
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("astroBasisBoundaryVerdict", () => {
  it("is applied for exactly one pair of the identity under one parent, enclosing an element", () => {
    expect(
      astroBasisBoundaryVerdict(
        IDENTITY,
        NONCE,
        page(
          `${open(OTHER)}<p>other</p>${close(OTHER)}${open(IDENTITY)}<!-- an author's comment --><section>a</section>${close(IDENTITY)}`,
        ),
      ),
    ).toEqual({ applied: true });
  });

  it("is applied with another boundary nested cleanly inside it", () => {
    for (const html of [
      `${open(IDENTITY)}<div>${open(OTHER)}<p>b</p>${close(OTHER)}</div>${close(IDENTITY)}`,
      `${open(IDENTITY)}${open(OTHER)}<p>b</p>${close(OTHER)}<p>a</p>${close(IDENTITY)}`,
    ]) {
      expect(astroBasisBoundaryVerdict(IDENTITY, NONCE, page(html)), html).toEqual(
        { applied: true },
      );
    }
  });

  it("is not applied with no pair, a duplicate, an unpaired or a split one", () => {
    const cases: Array<[string, string]> = [
      ["no-boundary", ""],
      ["no-boundary", `${open(OTHER)}<p>b</p>${close(OTHER)}`],
      [
        "duplicate-boundary",
        `${open(IDENTITY)}<p>a</p>${close(IDENTITY)}${open(IDENTITY)}<p>a</p>${close(IDENTITY)}`,
      ],
      [
        "duplicate-boundary",
        `${open(IDENTITY)}<p>a</p>${close(IDENTITY)}${close(IDENTITY)}`,
      ],
      ["unpaired-boundary", `${open(IDENTITY)}<p>a</p>`],
      ["unpaired-boundary", `<p>a</p>${close(IDENTITY)}`],
      ["unpaired-boundary", `${close(IDENTITY)}<p>a</p>${open(IDENTITY)}`],
      [
        "split-boundary",
        `<div>${open(IDENTITY)}<p>a</p></div><div>${close(IDENTITY)}</div>`,
      ],
    ];
    for (const [cause, html] of cases) {
      expect(
        astroBasisBoundaryVerdict(IDENTITY, NONCE, page(html)),
        html,
      ).toEqual({ applied: false, cause });
    }
  });

  // Review finding 4: the same checks the selection rule applies
  // (`judgeBoundary`), so the ack never says more than a click could.
  it("is not applied when another boundary crosses it, or when it holds no element", () => {
    const cases: Array<[string, string]> = [
      [
        "crossing-boundary",
        `${open(IDENTITY)}<p>a</p>${open(OTHER)}<p>b</p>${close(IDENTITY)}<p>c</p>${close(OTHER)}`,
      ],
      [
        "crossing-boundary",
        `${open(OTHER)}<p>b</p>${open(IDENTITY)}<p>a</p>${close(OTHER)}<p>c</p>${close(IDENTITY)}`,
      ],
      ["empty-boundary", `${open(IDENTITY)}${close(IDENTITY)}`],
      ["empty-boundary", `${open(IDENTITY)}text only${close(IDENTITY)}`],
    ];
    for (const [cause, html] of cases) {
      expect(
        astroBasisBoundaryVerdict(IDENTITY, NONCE, page(html)),
        html,
      ).toEqual({ applied: false, cause });
    }
  });

  it("never counts markers of another nonce, and refuses an identity of another one", () => {
    const foreign = `fedcba9876543210:2:${SRC}:10:42`;
    expect(
      astroBasisBoundaryVerdict(
        IDENTITY,
        NONCE,
        page(`${open(foreign)}<p>a</p>${close(foreign)}`),
      ),
    ).toEqual({ applied: false, cause: "no-boundary" });
    expect(
      astroBasisBoundaryVerdict(
        foreign,
        NONCE,
        page(`${open(foreign)}<p>a</p>${close(foreign)}`),
      ),
    ).toEqual({ applied: false, cause: "wrong-nonce" });
    expect(
      astroBasisBoundaryVerdict(
        IDENTITY,
        null,
        page(`${open(IDENTITY)}<p>a</p>${close(IDENTITY)}`),
      ),
    ).toEqual({ applied: false, cause: "wrong-nonce" });
  });

  it("does not read the old v1 format", () => {
    expect(
      astroBasisBoundaryVerdict(
        IDENTITY,
        NONCE,
        page(`<!--morph:s ${IDENTITY}--><p>a</p><!--/morph:s ${IDENTITY}-->`),
      ),
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
  const held = () => ({
    documentNavigation: true,
    nonce: NONCE,
    root: page(`${open(IDENTITY)}<section>a</section>${close(IDENTITY)}`),
    servedContent: { ticket: 7, instance: INSTANCE },
  });

  it("is applied on the document the token names", () => {
    expect(astroBasisAckVerdict({ token, ...held() })).toEqual({
      applied: true,
    });
  });

  it("never takes the boundary branch on a page that does not navigate as documents (Start)", () => {
    expect(
      astroBasisAckVerdict({ token, ...held(), documentNavigation: false }),
    ).toEqual({ applied: false, cause: "not-document-navigation" });
  });

  it("is not applied without a basis, a stamp, or on another snapshot", () => {
    const { basis: _basis, ...start } = token;
    expect(astroBasisAckVerdict({ token: start, ...held() })).toEqual({
      applied: false,
      cause: "no-basis",
    });
    expect(
      astroBasisAckVerdict({ token, ...held(), servedContent: null }),
    ).toEqual({ applied: false, cause: "no-served-content" });
    expect(
      astroBasisAckVerdict({
        token,
        ...held(),
        servedContent: { ticket: 6, instance: INSTANCE },
      }),
    ).toEqual({ applied: false, cause: "other-snapshot" });
    expect(
      astroBasisAckVerdict({
        token,
        ...held(),
        servedContent: {
          ticket: 7,
          instance: "11111111-2222-3333-4444-555555555555",
        },
      }),
    ).toEqual({ applied: false, cause: "other-snapshot" });
  });

  it("passes the boundary's own cause on", () => {
    expect(
      astroBasisAckVerdict({
        token,
        ...held(),
        root: page(`${open(IDENTITY)}<p>a</p>`),
      }),
    ).toEqual({ applied: false, cause: "unpaired-boundary" });
    expect(
      astroBasisAckVerdict({
        token,
        ...held(),
        root: page(`${open(IDENTITY)}${close(IDENTITY)}`),
      }),
    ).toEqual({ applied: false, cause: "empty-boundary" });
  });
});
