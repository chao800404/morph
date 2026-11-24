import { describe, expect, it } from "vitest";
import {
  PREVIEW_CAPABILITIES,
  PREVIEW_SERVED_CONTENT_TIMING,
  parseEditorToPreviewMessage,
  parsePreviewServedContent,
  parsePreviewToEditorMessage,
  previewServedContentFromEntries,
  sameSectionPresentationToken,
  type SectionPresentationToken,
} from "./preview-protocol";

/**
 * Option B of the Astro presentation ack
 * (handoff/2026-11-24/astro-presentation-ack-options.md): a basis token
 * names the v2 boundary identity and the content snapshot the frame says it
 * was rendered from. Every field is optional and absent for Start, whose
 * tokens and messages parse exactly as before.
 */

const INSTANCE = "0b1f5a52-3c1e-4f43-9d0e-6c0f2f1f9a11";
const IDENTITY = `0123456789abcdef:2:${"a".repeat(64)}:10:42`;

const startToken: SectionPresentationToken = {
  workspaceKey: "storefront-1:theme-1",
  templateId: "template-1",
  routePath: "/",
  sectionId: "hero",
  documentBasis: { kind: "existing", draftGeneration: 3 },
  overlayRevision: 2,
  presentationRevision: 5,
  operationId: "section-presentation-5",
};

const basisToken: SectionPresentationToken = {
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

describe("the served-content stamp", () => {
  it("is the metric the preview Worker writes", () => {
    expect(PREVIEW_SERVED_CONTENT_TIMING).toBe("morph-content");
  });

  it("parses `<ticket>.<instance>` and its JSON form, nothing else", () => {
    expect(parsePreviewServedContent(`7.${INSTANCE}`)).toEqual({
      ticket: 7,
      instance: INSTANCE,
    });
    expect(parsePreviewServedContent({ ticket: 7, instance: INSTANCE })).toEqual(
      { ticket: 7, instance: INSTANCE },
    );
    for (const value of [
      null,
      undefined,
      "",
      "7",
      `0.${INSTANCE}`,
      `-1.${INSTANCE}`,
      `7.5.${INSTANCE}`,
      `x.${INSTANCE}`,
      "7.short",
      `7.${INSTANCE}"`,
      { ticket: 0, instance: INSTANCE },
      { ticket: 7, instance: "short" },
      { ticket: "7", instance: INSTANCE },
    ]) {
      expect(parsePreviewServedContent(value), JSON.stringify(value)).toBe(null);
    }
  });

  it("is read from the document's own response only", () => {
    expect(
      previewServedContentFromEntries([
        { kind: "script", content: `9.${INSTANCE}` },
        { kind: "navigation", content: `7.${INSTANCE}` },
      ]),
    ).toEqual({ ticket: 7, instance: INSTANCE });
    expect(
      previewServedContentFromEntries([
        { kind: "script", content: `9.${INSTANCE}` },
      ]),
    ).toBe(null);
    expect(
      previewServedContentFromEntries([{ kind: "navigation", content: null }]),
    ).toBe(null);
    expect(previewServedContentFromEntries([])).toBe(null);
  });
});

describe("a basis token", () => {
  it("round-trips through the confirm message and the ack", () => {
    const posted = parseEditorToPreviewMessage({
      type: "morph:storefront-preview-confirm-section-basis",
      presentationToken: basisToken,
    });
    expect(posted).toEqual({
      type: "morph:storefront-preview-confirm-section-basis",
      presentationToken: basisToken,
    });
    const ack = parsePreviewToEditorMessage({
      type: "morph:storefront-preview-section-presentation-ack",
      operationId: basisToken.operationId,
      token: basisToken,
      status: "applied",
    });
    expect(ack).toEqual({
      type: "morph:storefront-preview-section-presentation-ack",
      operationId: basisToken.operationId,
      token: basisToken,
      status: "applied",
    });
  });

  it("is refused without a v2 identity, a served content, or with an overlay revision", () => {
    const refused = [
      { ...basisToken, basis: { ...basisToken.basis!, identity: "" } },
      { ...basisToken, basis: { ...basisToken.basis!, identity: "hero" } },
      { ...basisToken, basis: { ...basisToken.basis!, kind: "dom" } },
      {
        ...basisToken,
        basis: { kind: "astro-boundary", identity: IDENTITY },
      },
      {
        ...basisToken,
        basis: {
          ...basisToken.basis!,
          servedContent: { ticket: 0, instance: INSTANCE },
        },
      },
      { ...basisToken, overlayRevision: 1 },
      { ...basisToken, basis: null },
    ];
    for (const token of refused) {
      expect(
        parsePreviewToEditorMessage({
          type: "morph:storefront-preview-section-presentation-ack",
          operationId: token.operationId,
          token,
          status: "applied",
        }),
        JSON.stringify(token.basis),
      ).toBe(null);
    }
  });

  it("is the only token the confirm message carries", () => {
    expect(
      parseEditorToPreviewMessage({
        type: "morph:storefront-preview-confirm-section-basis",
        presentationToken: startToken,
      }),
    ).toBe(null);
    expect(
      parseEditorToPreviewMessage({
        type: "morph:storefront-preview-confirm-section-basis",
      }),
    ).toBe(null);
  });

  it("differs from the same token without its basis, or with another snapshot", () => {
    const { basis: _basis, ...withoutBasis } = basisToken;
    expect(sameSectionPresentationToken(basisToken, basisToken)).toBe(true);
    expect(sameSectionPresentationToken(basisToken, withoutBasis)).toBe(false);
    expect(sameSectionPresentationToken(withoutBasis, basisToken)).toBe(false);
    expect(
      sameSectionPresentationToken(basisToken, {
        ...basisToken,
        basis: {
          ...basisToken.basis!,
          servedContent: { ticket: 8, instance: INSTANCE },
        },
      }),
    ).toBe(false);
    expect(
      sameSectionPresentationToken(basisToken, {
        ...basisToken,
        basis: {
          ...basisToken.basis!,
          identity: `0123456789abcdef:2:${"a".repeat(64)}:10:43`,
        },
      }),
    ).toBe(false);
  });
});

describe("Start is unchanged", () => {
  it("parses a Start token with no basis key", () => {
    const parsed = parsePreviewToEditorMessage({
      type: "morph:storefront-preview-section-presentation-ack",
      operationId: startToken.operationId,
      token: startToken,
      status: "applied",
    });
    expect(parsed).toEqual({
      type: "morph:storefront-preview-section-presentation-ack",
      operationId: startToken.operationId,
      token: startToken,
      status: "applied",
    });
    expect(
      Object.keys(
        (parsed as { token: SectionPresentationToken }).token,
      ).sort(),
    ).toEqual(Object.keys(startToken).sort());
  });

  it("compares two Start tokens as before", () => {
    expect(sameSectionPresentationToken(startToken, { ...startToken })).toBe(
      true,
    );
    expect(
      sameSectionPresentationToken(startToken, {
        ...startToken,
        overlayRevision: 3,
      }),
    ).toBe(false);
  });

  it("parses a ready without a served content as before", () => {
    expect(
      parsePreviewToEditorMessage({
        type: "morph:storefront-preview-ready",
        capabilities: ["section-presentation-ack-v1"],
      }),
    ).toEqual({
      type: "morph:storefront-preview-ready",
      capabilities: ["section-presentation-ack-v1"],
    });
  });
});

describe("a document-navigation ready", () => {
  it("carries the served content and the basis capability", () => {
    expect(PREVIEW_CAPABILITIES).toContain("astro-basis-ack-v1");
    expect(
      parsePreviewToEditorMessage({
        type: "morph:storefront-preview-ready",
        capabilities: [
          "section-presentation-ack-v1",
          "astro-identity-v2",
          "astro-basis-ack-v1",
        ],
        servedContent: { ticket: 7, instance: INSTANCE },
      }),
    ).toEqual({
      type: "morph:storefront-preview-ready",
      capabilities: [
        "astro-identity-v2",
        "section-presentation-ack-v1",
        "astro-basis-ack-v1",
      ],
      servedContent: { ticket: 7, instance: INSTANCE },
    });
  });

  it("drops a malformed served content", () => {
    expect(
      parsePreviewToEditorMessage({
        type: "morph:storefront-preview-ready",
        servedContent: { ticket: 0, instance: INSTANCE },
      }),
    ).toEqual({ type: "morph:storefront-preview-ready" });
  });
});
