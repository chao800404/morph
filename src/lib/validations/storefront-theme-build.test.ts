import { describe, expect, it } from "vitest";
import { createStorefrontThemeBuildInputSchema } from "./storefront-theme-build";

const input = {
  storefrontId: "11111111-1111-4111-8111-111111111111",
  themeId: "22222222-2222-4222-8222-222222222222",
  sourceRevisionId: "33333333-3333-4333-8333-333333333333",
};

describe("theme build content binding input", () => {
  it("accepts only preconditions for draft sealing, not raw content or two publication sources", () => {
    const publicationDraft = {
      templateId: input.themeId,
      expectedDraftRevisionId: input.sourceRevisionId,
      expectedDraftGeneration: 1,
      expectedSourceGeneration: 1,
      expectedReleaseGeneration: 1,
    };
    expect(
      createStorefrontThemeBuildInputSchema.safeParse({
        ...input,
        publicationDraft,
      }).success,
    ).toBe(true);
    expect(
      createStorefrontThemeBuildInputSchema.safeParse({
        ...input,
        publicationDraft,
        contentPublicationId: input.themeId,
      }).success,
    ).toBe(false);
    expect(
      createStorefrontThemeBuildInputSchema.safeParse({
        ...input,
        publicationDraft: { ...publicationDraft, document: {} },
      }).success,
    ).toBe(false);
  });
  it("keeps source-only requests compatible", () => {
    expect(createStorefrontThemeBuildInputSchema.parse(input)).toEqual(input);
  });

  it("accepts a publication ID, not caller-supplied content", () => {
    const contentPublicationId = "44444444-4444-4444-8444-444444444444";
    expect(
      createStorefrontThemeBuildInputSchema.parse({
        ...input,
        contentPublicationId,
        contentSnapshot: { documents: [{ document: { sections: [] } }] },
      }),
    ).toEqual({ ...input, contentPublicationId });
  });

  it("refuses malformed publication IDs", () => {
    expect(
      createStorefrontThemeBuildInputSchema.safeParse({
        ...input,
        contentPublicationId: "not-a-publication-id",
      }).success,
    ).toBe(false);
  });
});
