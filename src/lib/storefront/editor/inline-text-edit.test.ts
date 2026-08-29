import { describe, expect, it } from "vitest";
import {
  INLINE_TEXT_EDIT_MAX_LENGTH,
  hasInlineTextDocumentTarget,
  isInlineTextEditCandidate,
  normalizeInlineTextEditValue,
  shouldNormalizeInlineTextInput,
} from "./inline-text-edit";

const directTextCandidate = {
  selectionEnabled: true,
  kind: "heading" as const,
  sectionId: "hero",
  fieldKey: "heading",
  fieldPath: "heading",
  descendantFieldCount: 0,
  isSection: false,
};

describe("inline text editing", () => {
  it("allows only a directly bound text selection", () => {
    expect(isInlineTextEditCandidate(directTextCandidate)).toBe(true);
    expect(
      isInlineTextEditCandidate({ ...directTextCandidate, kind: "input" }),
    ).toBe(false);
    expect(
      isInlineTextEditCandidate({
        ...directTextCandidate,
        descendantFieldCount: 1,
      }),
    ).toBe(false);
    expect(
      isInlineTextEditCandidate({ ...directTextCandidate, fieldPath: null }),
    ).toBe(false);
    expect(
      isInlineTextEditCandidate({
        ...directTextCandidate,
        selectionEnabled: false,
      }),
    ).toBe(false);
    expect(
      isInlineTextEditCandidate({ ...directTextCandidate, isSection: true }),
    ).toBe(false);
  });

  it("normalizes editable DOM text to bounded plain text", () => {
    expect(normalizeInlineTextEditValue("first\r\nsecond\u00a0line")).toBe(
      "first\nsecond line",
    );
    expect(
      normalizeInlineTextEditValue("x".repeat(INLINE_TEXT_EDIT_MAX_LENGTH + 1)),
    ).toHaveLength(INLINE_TEXT_EDIT_MAX_LENGTH);
  });

  it("accepts both stored sections and route-first content slots", () => {
    expect(hasInlineTextDocumentTarget("hero", ["hero"], [])).toBe(true);
    expect(hasInlineTextDocumentTarget("journal", [], ["journal"])).toBe(true);
    expect(hasInlineTextDocumentTarget("missing", ["hero"], ["journal"])).toBe(
      false,
    );
  });

  it("does not rewrite the editable DOM while an IME composition is active", () => {
    expect(shouldNormalizeInlineTextInput(true, false)).toBe(false);
    expect(shouldNormalizeInlineTextInput(false, true)).toBe(false);
    expect(shouldNormalizeInlineTextInput(false, false)).toBe(true);
  });
});
