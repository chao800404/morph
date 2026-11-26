import { describe, expect, it } from "vitest";
import type { SectionPresentationToken } from "./preview-protocol";
import type { AstroContentBasis } from "./astro-basis-presentation";
import type { ConfirmedAstroDesignSelection } from "./astro-design-focus";
import {
  astroBasisProofCurrent,
  astroInspectorFields,
  astroWriteIdentityForProof,
} from "./astro-inspector-write";

/**
 * M2 PR 3: what the editor takes as an Astro write's presentation proof, the
 * identity it sends with it, and the fields the Inspector offers. Each is a
 * narrowing in the editor only: Core verifies identity, component digest and
 * both CASes on every write again.
 */

const INSTANCE = "0b1f5a52-3c1e-4f43-9d0e-6c0f2f1f9a11";
const MARKER = `0123456789abcdef:2:${"a".repeat(64)}:30:60`;
const DIGEST = "c".repeat(64);

const basisToken = (
  overrides: Partial<SectionPresentationToken> = {},
): SectionPresentationToken => ({
  workspaceKey: "storefront-1:theme-1",
  templateId: "template-1",
  routePath: "/",
  sectionId: "hero",
  documentBasis: { kind: "existing", draftGeneration: 4 },
  overlayRevision: 0,
  presentationRevision: 3,
  operationId: "section-basis-3",
  basis: {
    kind: "astro-boundary",
    identity: MARKER,
    servedContent: { ticket: 7, instance: INSTANCE },
  },
  ...overrides,
});

const coreBasis = (
  overrides: Partial<AstroContentBasis> = {},
): AstroContentBasis => ({
  ticket: 7,
  instance: INSTANCE,
  draftGenerations: { "template-1": 4 },
  ...overrides,
});

const selection = (
  overrides: Partial<ConfirmedAstroDesignSelection> = {},
): ConfirmedAstroDesignSelection => ({
  status: "confirmed",
  sectionId: "hero",
  identity: MARKER,
  componentDigest: DIGEST,
  componentRef: "src/components/Hero.astro#default",
  sectionType: "hero",
  declaredFields: ["title", "subtitle"],
  fields: ["title", "subtitle"],
  ...overrides,
});

describe("astroBasisProofCurrent", () => {
  const current = (
    args: Partial<Parameters<typeof astroBasisProofCurrent>[0]> = {},
  ) =>
    astroBasisProofCurrent({
      token: basisToken(),
      servedContent: { ticket: 7, instance: INSTANCE },
      basis: coreBasis(),
      acceptedDraftGeneration: 4,
      ...args,
    });

  it("is current while the frame and Core still name the token's snapshot and generation", () => {
    expect(current()).toBe(true);
  });

  it("an overlay token (every Start token) is never an Astro proof", () => {
    const { basis: _none, ...overlay } = basisToken();
    expect(current({ token: overlay })).toBe(false);
  });

  it("is not current once Core wrote a newer snapshot for this editor", () => {
    expect(
      current({
        basis: coreBasis({
          ticket: 8,
          instance: null,
          draftGenerations: { "template-1": 5 },
        }),
      }),
    ).toBe(false);
  });

  it("is not current on a frame stamped with another snapshot or instance", () => {
    expect(
      current({ servedContent: { ticket: 6, instance: INSTANCE } }),
    ).toBe(false);
    expect(
      current({
        servedContent: {
          ticket: 7,
          instance: "11111111-2222-3333-4444-555555555555",
        },
      }),
    ).toBe(false);
    expect(current({ servedContent: null })).toBe(false);
  });

  it("is not current when Core has no confirmed record at all", () => {
    expect(current({ basis: null })).toBe(false);
  });

  it("is not current while the editor holds a newer copy than the frame shows", () => {
    // The editor's own write was answered at 5; the frame still shows 4.
    expect(current({ acceptedDraftGeneration: 5 })).toBe(false);
  });

  it("an older or unknown accepted copy does not make it stale", () => {
    expect(current({ acceptedDraftGeneration: 3 })).toBe(true);
    expect(current({ acceptedDraftGeneration: undefined })).toBe(true);
  });
});

describe("astroWriteIdentityForProof", () => {
  it("sends the identity the token named and Core's digest, as Core confirmed them", () => {
    expect(
      astroWriteIdentityForProof({
        token: basisToken(),
        issued: selection(),
        sectionId: "hero",
      }),
    ).toEqual({ identity: MARKER, componentDigest: DIGEST });
  });

  it("refuses with no selection recorded for the token", () => {
    expect(
      astroWriteIdentityForProof({
        token: basisToken(),
        issued: undefined,
        sectionId: "hero",
      }),
    ).toBeNull();
  });

  it("refuses a token for another identity than the confirmed selection", () => {
    expect(
      astroWriteIdentityForProof({
        token: basisToken(),
        issued: selection({
          identity: `0123456789abcdef:2:${"a".repeat(64)}:31:61`,
        }),
        sectionId: "hero",
      }),
    ).toBeNull();
  });

  it("refuses a write of another section than the token and the selection", () => {
    expect(
      astroWriteIdentityForProof({
        token: basisToken(),
        issued: selection(),
        sectionId: "promo",
      }),
    ).toBeNull();
    expect(
      astroWriteIdentityForProof({
        token: basisToken({ sectionId: "promo" }),
        issued: selection(),
        sectionId: "hero",
      }),
    ).toBeNull();
  });

  it("refuses an overlay token", () => {
    const { basis: _none, ...overlay } = basisToken();
    expect(
      astroWriteIdentityForProof({
        token: overlay,
        issued: selection(),
        sectionId: "hero",
      }),
    ).toBeNull();
  });
});

describe("astroInspectorFields", () => {
  const declaration = {
    title: { type: "text", label: "Title" },
    subtitle: { type: "textarea", label: "Subtitle" },
    image: { type: "image", label: "Image" },
  } as const;

  it("offers a declared field Core proves this call site passes from the section", () => {
    expect(
      astroInspectorFields(selection(), declaration).map((field) => [
        field.key,
        field.input,
      ]),
    ).toEqual([
      ["title", "text"],
      ["subtitle", "textarea"],
    ]);
  });

  it("a declared field Core does not prove gets no input", () => {
    const fields = astroInspectorFields(
      selection({ fields: ["title"] }),
      declaration,
    );
    expect(fields.map((field) => field.key)).toEqual(["title"]);
  });

  it("a proven field the .fields.ts declaration does not declare gets no input", () => {
    const fields = astroInspectorFields(
      selection({ fields: ["title", "eyebrow"] }),
      declaration,
    );
    expect(fields.map((field) => field.key)).toEqual(["title"]);
  });

  it("a field Design cannot edit as text yet is listed for Code, with no input", () => {
    const fields = astroInspectorFields(
      selection({ fields: ["title", "image"] }),
      declaration,
    );
    expect(fields).toEqual([
      { key: "title", label: "Title", input: "text" },
      { key: "image", label: "Image", input: null },
    ]);
  });

  it("no declaration means no input at all", () => {
    expect(astroInspectorFields(selection(), null)).toEqual([]);
  });
});
