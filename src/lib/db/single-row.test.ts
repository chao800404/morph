import { describe, expect, expectTypeOf, it } from "vitest";
import { firstOrNull } from "./single-row";

describe("firstOrNull", () => {
  it("returns the single row of a limit(1) read", () => {
    expect(firstOrNull([{ id: "a" }])).toEqual({ id: "a" });
  });

  it("returns null when the read found nothing", () => {
    expect(firstOrNull([])).toBeNull();
  });

  it("ignores rows beyond the first", () => {
    expect(firstOrNull([{ id: "a" }, { id: "b" }])).toEqual({ id: "a" });
  });

  it("declares absence in the type so callers must handle not-found", () => {
    expectTypeOf(firstOrNull<{ id: string }>([])).toEqualTypeOf<
      { id: string } | null
    >();
  });
});
