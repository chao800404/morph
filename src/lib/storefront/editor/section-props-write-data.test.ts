import { describe, expect, it } from "vitest";
import { updateStorefrontThemeSectionPropsInputSchema } from "@/lib/validations/storefront-theme";
import { sectionPropsWriteData } from "./section-props-write-data";

const SCOPE = {
  storefrontId: "11111111-1111-4111-8111-111111111111",
  themeId: "22222222-2222-4222-8222-222222222222",
  activeTemplateId: "33333333-3333-4333-8333-333333333333",
};
const IDENTITY = `0123456789abcdef:2:${"a".repeat(64)}:120:158`;
const DIGEST = "c".repeat(64);

describe("sectionPropsWriteData", () => {
  it("sends a Start write exactly as the editor did before PR-F", () => {
    const data = sectionPropsWriteData(SCOPE, {
      sectionId: "hero",
      props: { title: "Hi" },
      expectedDraftGeneration: 4,
      expectedSourceGeneration: 9,
      routePath: "/guard",
      resetProps: ["subtitle"],
    });
    // The literal the mutation built inline before, key for key.
    expect(data).toStrictEqual({
      storefrontId: SCOPE.storefrontId,
      themeId: SCOPE.themeId,
      templateId: SCOPE.activeTemplateId,
      sectionId: "hero",
      props: { title: "Hi" },
      expectedDraftGeneration: 4,
      expectedSourceGeneration: 9,
      routePath: "/guard",
      resetProps: ["subtitle"],
    });
    expect("identity" in data).toBe(false);
    expect("componentDigest" in data).toBe(false);
  });

  it("omits empty optional parts as before", () => {
    const data = sectionPropsWriteData(SCOPE, {
      sectionId: "hero",
      props: {},
      expectedDraftGeneration: 1,
      expectedSourceGeneration: 1,
      templateId: "44444444-4444-4444-8444-444444444444",
      resetProps: [],
    });
    expect(data).toStrictEqual({
      storefrontId: SCOPE.storefrontId,
      themeId: SCOPE.themeId,
      templateId: "44444444-4444-4444-8444-444444444444",
      sectionId: "hero",
      props: {},
      expectedDraftGeneration: 1,
      expectedSourceGeneration: 1,
    });
  });

  it("carries a confirmed Astro identity and Core's digest, which the server schema accepts", () => {
    const data = sectionPropsWriteData(SCOPE, {
      sectionId: "hero",
      props: { title: "Hi" },
      expectedDraftGeneration: 2,
      expectedSourceGeneration: 3,
      identity: IDENTITY,
      componentDigest: DIGEST,
    });
    expect(data).toMatchObject({ identity: IDENTITY, componentDigest: DIGEST });
    const parsed = updateStorefrontThemeSectionPropsInputSchema.safeParse(data);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({
      identity: IDENTITY,
      componentDigest: DIGEST,
    });
  });

  it("never sends half an identity", () => {
    const base = {
      sectionId: "hero",
      props: {},
      expectedDraftGeneration: 1,
      expectedSourceGeneration: 1,
    };
    expect(
      sectionPropsWriteData(SCOPE, { ...base, identity: IDENTITY }),
    ).not.toHaveProperty("identity");
    expect(
      sectionPropsWriteData(SCOPE, { ...base, componentDigest: DIGEST }),
    ).not.toHaveProperty("componentDigest");
  });
});
