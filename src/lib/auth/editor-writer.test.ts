// @vitest-environment node
import { describe, expect, it } from "vitest";
import { claimsAnotherWriter, editorWriterClaim } from "./editor-writer";

describe("claimsAnotherWriter", () => {
  it("is a mismatch only for a claim naming someone else", () => {
    expect(claimsAnotherWriter("user-a", "user-b")).toBe(true);
    expect(claimsAnotherWriter("user-a", "user-a")).toBe(false);
  });

  it("reads no claim as no mismatch", () => {
    for (const claim of [undefined, null, "", 42, { id: "user-a" }]) {
      expect(claimsAnotherWriter(claim, "user-b")).toBe(false);
    }
  });
});

describe("editorWriterClaim", () => {
  it("reads the claim from a middleware context, and nothing else", () => {
    expect(editorWriterClaim({ editorWriter: "user-a" })).toBe("user-a");
    expect(editorWriterClaim({})).toBeUndefined();
    expect(editorWriterClaim(undefined)).toBeUndefined();
    expect(editorWriterClaim("user-a")).toBeUndefined();
  });
});
