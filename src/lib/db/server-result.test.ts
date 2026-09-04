import { describe, expect, it } from "vitest";
import { z } from "zod";

import { parseInput } from "./server-result";

const schema = z
  .object({
    path: z.string().min(1),
    expectedFileId: z.string().uuid().optional(),
    expectMissing: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (!value.expectMissing && !value.expectedFileId) {
      ctx.addIssue({
        code: "custom",
        message: "Existing file writes require expectedFileId",
      });
    }
  });

describe("parseInput", () => {
  it("returns the parsed value with defaults applied", () => {
    const result = parseInput(schema, {
      path: "src/app.tsx",
      expectedFileId: "11111111-1111-4111-8111-111111111111",
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(result.data.expectMissing).toBe(false);
  });

  it("reports a rejected precondition instead of throwing", () => {
    // This is the case that used to escape the validator and reach the browser
    // as `{"status":500,"unhandled":true,"message":"HTTPError"}` — a 500 with
    // no field and no reason, for what is really a rejected request.
    const result = parseInput(schema, { path: "src/app.tsx" });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.error).toBe("INVALID_INPUT");
    expect(result.message).toContain("expectedFileId");
  });

  it("names the offending field so the reason is actionable", () => {
    const result = parseInput(schema, { path: "", expectMissing: true });

    if (result.success) throw new Error("expected failure");
    expect(result.errors).toHaveProperty("path");
  });

  it("keeps top-level issues addressable when they belong to no field", () => {
    const result = parseInput(schema, { path: "src/app.tsx" });

    if (result.success) throw new Error("expected failure");
    expect(Object.keys(result.errors ?? {})).toContain("_");
  });
});
