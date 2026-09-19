// @vitest-environment node
import { describe, expect, it } from "vitest";
import { containsPattern, prefixPattern } from "./like-pattern";

/**
 * The cap is bytes, so these are byte assertions throughout.
 *
 * Measured against D1: a 48-byte term (a 50-byte pattern) succeeds and a
 * 49-byte term fails, for ASCII and for CJK alike. That last part is why the
 * truncation is byte-aware rather than character-aware — a Chinese search breaks
 * at 16 characters where an English one reaches 48, and a user hits it far
 * sooner than a developer would guess.
 */
const bytes = (value: string) => new TextEncoder().encode(value).length;

describe("containsPattern", () => {
  it("leaves a term that already fits alone", () => {
    expect(containsPattern("shirt")).toBe("%shirt%");
    expect(bytes(containsPattern("a".repeat(48)))).toBe(50);
  });

  it("cuts a term that does not fit, to the byte", () => {
    const pattern = containsPattern("a".repeat(49));
    expect(bytes(pattern)).toBe(50);
    expect(pattern).toBe(`%${"a".repeat(48)}%`);
  });

  it("counts CJK as three bytes, which is where users meet the cap", () => {
    // 20 characters, 60 bytes: cut to 16 characters, 48 bytes.
    const pattern = containsPattern("\u5546\u54c1\u641c\u7d22\u6e2c\u8a66\u5546\u54c1\u641c\u7d22\u6e2c\u8a66\u5546\u54c1\u641c\u7d22\u6e2c\u8a66\u5546\u54c1");
    expect(bytes(pattern)).toBe(50);
    expect([...pattern.slice(1, -1)]).toHaveLength(16);
    // Every survivor is a whole character; a cut through one would leave a
    // replacement character and search for something nobody typed.
    expect(pattern).not.toContain("\uFFFD");
  });

  it("never splits a surrogate pair", () => {
    // Four-byte emoji: 12 of them is 48 bytes, the 13th must be dropped whole.
    const pattern = containsPattern("\u{1F600}".repeat(13));
    expect(bytes(pattern)).toBe(50);
    expect([...pattern.slice(1, -1)]).toHaveLength(12);
    expect(pattern).not.toContain("\uFFFD");
  });
});

describe("prefixPattern", () => {
  it("leaves a prefix that fits alone", () => {
    expect(prefixPattern("reset-access:")).toBe("reset-access:%");
    // A prefix spends one byte on the wildcard, so 49 is the most it may keep.
    expect(bytes(prefixPattern("a".repeat(49)))).toBe(50);
  });

  it("throws instead of truncating, and names the replacement", () => {
    // This replaces an assertion that expected a 60-byte prefix to come back as
    // a 50-byte pattern. That assertion was wrong, not merely inconvenient: it
    // encoded truncation as the contract. Truncation drops the last byte, and on
    // a well-formed prefix the last byte is the delimiter that makes it a
    // boundary — so the pattern stops matching a subtree and starts matching its
    // parent's. It was also asserted on `"a".repeat(60)`, a shape chosen to be
    // obviously synthetic, which hid that the real input is a path and hits the
    // cap before its second level.
    expect(() => prefixPattern("a".repeat(50))).toThrow();

    // The case that actually occurs: two UUIDs plus separators is 75 bytes.
    const twoLevelPath = `/${"u".repeat(36)}/${"v".repeat(36)}/`;
    expect(bytes(twoLevelPath)).toBe(75);
    expect(() => prefixPattern(twoLevelPath)).toThrow();

    // The pointer is part of the contract, so it is asserted too — a message
    // that rots back to "pattern too long" would fail here.
    expect(() => prefixPattern("a".repeat(50))).toThrow(/half-open range/);
    expect(() => prefixPattern("a".repeat(50))).toThrow(/startsWithPrefix/);
  });
});
