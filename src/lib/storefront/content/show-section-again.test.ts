import { describe, expect, it } from "vitest";
import { showStorefrontSectionAgainInputSchema } from "@/lib/validations/storefront-theme";
import {
  SHOW_AGAIN_DOCUMENT_INVALID,
  SHOW_AGAIN_VALUE_NOT_PRESERVED,
} from "../theme-write-errors";
import { showSectionAgainInDocument } from "./show-section-again";

/** A stored draft as text, with `extra` spliced into the hero's props. */
const stored = (extra: string, hidden = "newsletter") =>
  `{"version":1,"sections":[{"id":"hero","type":"hero","enabled":true,"props":{"title":"Hi"${extra}}},{"id":"${hidden}","type":"newsletter","enabled":false,"props":{"heading":"Join"}}]}`;

describe("showSectionAgainInDocument: values survive the write", () => {
  it("refuses an integer a double cannot hold, anywhere in the draft", () => {
    expect(showSectionAgainInDocument(stored(`,"count":9007199254740993`), "newsletter")).toEqual({
      kind: "refused",
      code: SHOW_AGAIN_VALUE_NOT_PRESERVED,
    });
  });

  it("refuses -0, and a key stored twice", () => {
    expect(showSectionAgainInDocument(stored(`,"offset":-0`), "newsletter")).toMatchObject({
      code: SHOW_AGAIN_VALUE_NOT_PRESERVED,
    });
    expect(
      showSectionAgainInDocument(stored(`,"title":"Twice"`), "newsletter"),
    ).toMatchObject({ code: SHOW_AGAIN_VALUE_NOT_PRESERVED });
  });

  it("accepts what changes only spelling: whitespace, escapes, 1.0 and exponents", () => {
    const text = JSON.stringify(JSON.parse(stored(`,"ratio":1.0,"big":1E2,"name":"caf\\u00e9"`)), null, 2)
      .replace('"ratio": 1', '"ratio": 1.0')
      .replace('"big": 100', '"big": 1E2')
      .replace('"name": "café"', '"name": "caf\\u00e9"');
    const outcome = showSectionAgainInDocument(text, "newsletter");
    expect(outcome.kind).toBe("shown");
    expect(outcome.kind === "shown" && outcome.document.sections[0]!.props).toEqual({
      title: "Hi",
      ratio: 1,
      big: 100,
      name: "café",
    });
  });

  it("accepts a safe integer at the limit (control)", () => {
    expect(
      showSectionAgainInDocument(stored(`,"count":9007199254740991`), "newsletter").kind,
    ).toBe("shown");
  });
});

describe("showSectionAgainInDocument: the stored draft is judged first", () => {
  it("refuses `enabled: null` as an invalid draft, not as shown", () => {
    const text = stored("").replace('"enabled":false', '"enabled":null');
    expect(showSectionAgainInDocument(text, "newsletter")).toEqual({
      kind: "refused",
      code: SHOW_AGAIN_DOCUMENT_INVALID,
    });
  });

  it("refuses text that is not JSON", () => {
    expect(showSectionAgainInDocument("{", "newsletter")).toEqual({
      kind: "refused",
      code: SHOW_AGAIN_DOCUMENT_INVALID,
    });
  });
});

describe("the section is named by its stored id exactly", () => {
  it('shows " hero " and leaves "hero" as it is', () => {
    const text = `{"version":1,"sections":[{"id":"hero","type":"hero","enabled":false,"props":{}},{"id":" hero ","type":"hero","enabled":false,"props":{}}]}`;
    const outcome = showSectionAgainInDocument(text, " hero ");
    expect(outcome.kind === "shown" && outcome.document.sections.map((s) => [s.id, s.enabled])).toEqual([
      ["hero", false],
      [" hero ", true],
    ]);
  });

  it("the request keeps the id as sent and takes every id a Document stores", () => {
    const base = {
      kind: "page",
      pageId: "44444444-4444-4444-8444-444444444444",
      expectedDraftVersion: 1,
    };
    const parsed = (sectionId: string) =>
      showStorefrontSectionAgainInputSchema.safeParse({ ...base, sectionId });
    expect(parsed(" hero ")).toMatchObject({ success: true, data: { sectionId: " hero " } });
    expect(parsed("/promo")).toMatchObject({ success: true, data: { sectionId: "/promo" } });
    expect(parsed("   ").success).toBe(false);
    expect(parsed("x".repeat(101)).success).toBe(false);
  });
});
