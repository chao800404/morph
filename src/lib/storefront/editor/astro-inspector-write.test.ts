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
  ownKeyFields: [],
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
      latest: basisToken(),
      acknowledged: basisToken(),
      ...args,
    });

  it("is current while the frame and Core still name the token's snapshot and generation", () => {
    expect(current()).toBe(true);
  });

  // Codex review P1: a click again issues a newer latest token and drops
  // the section's acknowledgement; the older token is then no proof.
  it("is not current once the section has a newer latest token, answered or not", () => {
    const newer = basisToken({
      presentationRevision: 4,
      operationId: "section-basis-4",
    });
    expect(current({ latest: newer, acknowledged: undefined })).toBe(false);
    expect(current({ latest: newer, acknowledged: newer })).toBe(false);
  });

  it("is not current while its applied is not the one taken for the section", () => {
    expect(current({ acknowledged: undefined })).toBe(false);
    expect(current({ latest: undefined })).toBe(false);
  });

  // Codex review P2: a static route with no Document of its own is
  // presented under its placeholder, as a new document.
  describe("for a route with no Document of its own yet", () => {
    const placeholder = "placeholder-route:/about";
    const routeToken = basisToken({
      templateId: placeholder,
      routePath: "/about",
      documentBasis: { kind: "new-document", createEpoch: placeholder },
    });
    const routeCurrent = (
      args: Partial<Parameters<typeof astroBasisProofCurrent>[0]> = {},
    ) =>
      current({
        token: routeToken,
        latest: routeToken,
        acknowledged: routeToken,
        acceptedDraftGeneration: undefined,
        ...args,
      });

    it("is current while the editor holds no copy of the route's document", () => {
      expect(routeCurrent()).toBe(true);
    });

    it("is not current once the editor holds a copy, or the document was created elsewhere", () => {
      expect(routeCurrent({ acceptedDraftGeneration: 2 })).toBe(false);
      expect(routeCurrent({ routeDocumentCreatedElsewhere: true })).toBe(false);
    });

    it("is not current when Core's snapshot holds a document under that id, or the epoch is another", () => {
      expect(
        routeCurrent({
          basis: coreBasis({
            draftGenerations: { "template-1": 4, [placeholder]: 1 },
          }),
        }),
      ).toBe(false);
      const otherEpoch = basisToken({
        templateId: placeholder,
        documentBasis: { kind: "new-document", createEpoch: "template-1" },
      });
      expect(
        routeCurrent({
          token: otherEpoch,
          latest: otherEpoch,
          acknowledged: otherEpoch,
        }),
      ).toBe(false);
    });
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
      // Declared, not proven: listed for Code (the case below), no input.
      ["image", null],
    ]);
  });

  // D3 rows 6-9. This case used to expect the unproven field to be dropped
  // from the list (`["title"]`). That assertion held the defect: rule 02
  // section 5.3.1 says a field Design cannot prove writable is shown as
  // code-only, not hidden, as Start's Inspector marks it controlled by code.
  // The new assertion keeps the boundary (no input, so no write) and adds
  // the visible state.
  it("a declared field Core does not prove is listed as controlled by code, with no input", () => {
    const fields = astroInspectorFields(
      selection({ fields: ["title"] }),
      declaration,
    );
    expect(fields).toEqual([
      { key: "title", label: "Title", input: "text", codeOnly: null },
      {
        key: "subtitle",
        label: "Subtitle",
        input: null,
        codeOnly: "controlled-by-code",
      },
      {
        key: "image",
        label: "Image",
        input: null,
        codeOnly: "controlled-by-code",
      },
    ]);
  });

  it("a proven field the .fields.ts declaration does not declare gets no input", () => {
    const fields = astroInspectorFields(
      selection({ fields: ["title", "subtitle", "image", "eyebrow"] }),
      declaration,
    );
    expect(fields.map((field) => field.key)).toEqual([
      "title",
      "subtitle",
      "image",
    ]);
  });

  it("a field Design cannot edit as text yet is listed for Code, with no input", () => {
    const fields = astroInspectorFields(
      selection({ fields: ["title", "subtitle", "image"] }),
      declaration,
    );
    expect(fields).toEqual([
      { key: "title", label: "Title", input: "text", codeOnly: null },
      { key: "subtitle", label: "Subtitle", input: "textarea", codeOnly: null },
      { key: "image", label: "Image", input: null, codeOnly: "unsupported-type" },
    ]);
  });

  // D3 row 5: `<Hero title="Code literal" {...hero} />` claims `title` only
  // while the stored section has its own `title` (Core refuses the write
  // otherwise, `source-key-absent`). Without one the literal shows, so the
  // Inspector offers no input Core would refuse.
  describe("a field a literal before the spread takes from the section only when stored", () => {
    const literalFirst = selection({
      fields: ["title", "subtitle"],
      ownKeyFields: ["title"],
    });
    const titleOf = (stored: Record<string, unknown> | null) =>
      astroInspectorFields(literalFirst, declaration, stored).find(
        (field) => field.key === "title",
      );

    it("is controlled by code while the stored section has no such key", () => {
      expect(titleOf({ subtitle: "s" })).toEqual({
        key: "title",
        label: "Title",
        input: null,
        codeOnly: "controlled-by-code",
      });
      expect(titleOf({ title: undefined, subtitle: "s" })?.codeOnly).toBe(
        "controlled-by-code",
      );
      expect(titleOf(null)?.codeOnly).toBe("controlled-by-code");
    });

    it("is editable once the stored section holds it", () => {
      expect(titleOf({ title: "", subtitle: "s" })).toEqual({
        key: "title",
        label: "Title",
        input: "text",
        codeOnly: null,
      });
    });

    it("leaves a field without that condition editable", () => {
      expect(
        astroInspectorFields(literalFirst, declaration, {}).find(
          (field) => field.key === "subtitle",
        ),
      ).toMatchObject({ input: "textarea", codeOnly: null });
    });
  });

  it("no declaration means no input at all", () => {
    expect(astroInspectorFields(selection(), null)).toEqual([]);
  });
});
