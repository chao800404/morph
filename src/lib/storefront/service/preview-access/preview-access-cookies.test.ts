import { describe, expect, it } from "vitest";
import { isPlatformCredentialCookieName } from "@/lib/auth/platform-cookies";
import {
  isPreviewAccessCookieName,
  MAX_PREVIEW_ACCESS_COOKIE_HEADER_BYTES,
  PREVIEW_ACCESS_BINDER_COOKIE_PREFIX,
  PREVIEW_ACCESS_GRANT_COOKIE_PREFIX,
  readPreviewAccessCandidates,
} from "./preview-access-cookies";

const flow = (n: number) => n.toString(16).padStart(32, "0");
const token = (n: number) => n.toString(16).padStart(64, "0");
const grant = (n: number, value = token(n)) =>
  `${PREVIEW_ACCESS_GRANT_COOKIE_PREFIX}${flow(n)}=${value}`;

describe("the preview host's grant cookies", () => {
  it("reads every well-formed grant, and leaves the Theme's own cookies and binders out", () => {
    const header = [
      "theme_cart=abc",
      grant(1),
      `${PREVIEW_ACCESS_BINDER_COOKIE_PREFIX}${flow(9)}=${token(9)}`,
      grant(2),
    ].join("; ");

    expect(readPreviewAccessCandidates(header)).toEqual({
      kind: "candidates",
      tokens: [token(1), token(2)],
      malformedNames: [],
    });
  });

  it("checks a token once whatever names it came under", () => {
    const header = [
      grant(1),
      grant(1),
      `${PREVIEW_ACCESS_GRANT_COOKIE_PREFIX}${flow(2)}=${token(1)}`,
    ].join("; ");

    expect(readPreviewAccessCandidates(header)).toMatchObject({
      kind: "candidates",
      tokens: [token(1)],
    });
  });

  it("counts a wrong-shaped flow id or value as malformed, never as a candidate", () => {
    const header = [
      `${PREVIEW_ACCESS_GRANT_COOKIE_PREFIX}not-a-flow=${token(1)}`,
      `${PREVIEW_ACCESS_GRANT_COOKIE_PREFIX}${flow(2)}=short`,
      grant(3),
    ].join("; ");

    expect(readPreviewAccessCandidates(header)).toEqual({
      kind: "candidates",
      tokens: [token(3)],
      malformedNames: [
        `${PREVIEW_ACCESS_GRANT_COOKIE_PREFIX}not-a-flow`,
        `${PREVIEW_ACCESS_GRANT_COOKIE_PREFIX}${flow(2)}`,
      ],
    });
  });

  it("serves 8 distinct values, duplicates included", () => {
    const header = [
      ...Array.from({ length: 8 }, (_, i) => grant(i + 1)),
      grant(1),
    ].join("; ");

    const read = readPreviewAccessCandidates(header);
    expect(read.kind).toBe("candidates");
    expect(read.kind === "candidates" && read.tokens).toHaveLength(8);
  });

  it("refuses 9 distinct values rather than picking 8 of them", () => {
    const header = Array.from({ length: 9 }, (_, i) => grant(i + 1)).join("; ");

    expect(readPreviewAccessCandidates(header)).toEqual({
      kind: "overflow",
      reason: "too-many-values",
    });
  });

  it("refuses more than 32 prefixed names, malformed ones counted", () => {
    const header = [
      grant(1),
      ...Array.from(
        { length: 32 },
        (_, i) => `${PREVIEW_ACCESS_GRANT_COOKIE_PREFIX}x${i}=bad`,
      ),
    ].join("; ");

    expect(readPreviewAccessCandidates(header)).toEqual({
      kind: "overflow",
      reason: "too-many-names",
    });
  });

  it("refuses a Cookie header over 16 KiB before reading it", () => {
    const header = `${grant(1)}; filler=${"x".repeat(MAX_PREVIEW_ACCESS_COOKIE_HEADER_BYTES)}`;

    expect(readPreviewAccessCandidates(header)).toEqual({
      kind: "overflow",
      reason: "header-too-large",
    });
  });

  it("reads no candidate from a request without cookies", () => {
    expect(readPreviewAccessCandidates(null)).toEqual({
      kind: "candidates",
      tokens: [],
      malformedNames: [],
    });
  });

  it("names grant and binder cookies as platform credentials, so no Theme receives them", () => {
    for (const name of [
      `${PREVIEW_ACCESS_GRANT_COOKIE_PREFIX}${flow(1)}`,
      `${PREVIEW_ACCESS_BINDER_COOKIE_PREFIX}${flow(1)}`,
    ]) {
      expect(isPreviewAccessCookieName(name), name).toBe(true);
      expect(isPlatformCredentialCookieName(name), name).toBe(true);
    }
    expect(isPlatformCredentialCookieName("theme_cart")).toBe(false);
    expect(isPlatformCredentialCookieName("morph-preference")).toBe(false);
  });
});
