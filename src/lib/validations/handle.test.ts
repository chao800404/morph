import { describe, expect, it } from "vitest";
import { toHandle, typedHandleSchema } from "./product";

describe("toHandle", () => {
  it("slugifies what the author typed instead of rejecting it", () => {
    // The reported failure: typing "Summer Shirt" into the Handle field
    // surfaced a raw Zod issue array in a toast, because the input schema
    // rejected it before the handler could derive anything.
    const result = toHandle("Summer Shirt", "ignored");

    expect(result.success && result.data).toBe("summer-shirt");
  });

  it("leaves an already-valid handle exactly as typed", () => {
    const result = toHandle("summer-shirt", "ignored");

    expect(result.success && result.data).toBe("summer-shirt");
  });

  it("falls back to the record's name when nothing was typed", () => {
    expect(toHandle(undefined, "Summer Shirt").success && true).toBe(true);
    expect(
      (toHandle(undefined, "Summer Shirt") as { data: string }).data,
    ).toBe("summer-shirt");
    expect((toHandle("   ", "Summer Shirt") as { data: string }).data).toBe(
      "summer-shirt",
    );
  });

  it("still fails when nothing survives slugifying", () => {
    // The safety net: a name of only punctuation leaves an empty string, and
    // the handler turns this into a field-level error rather than storing "".
    const result = toHandle("!!!", "###");

    expect(result.success).toBe(false);
  });
});

describe("typedHandleSchema", () => {
  it("accepts the shapes an author can type", () => {
    for (const value of ["Summer Shirt", "SUMMER", "summer_shirt", "夏季襯衫"]) {
      expect(typedHandleSchema.safeParse(value).success).toBe(true);
    }
  });

  it("still bounds the length", () => {
    expect(typedHandleSchema.safeParse("a".repeat(201)).success).toBe(false);
  });
});
