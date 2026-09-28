import { describe, expect, it } from "vitest";
import {
  createShippingOptionTypeInputSchema,
  updateShippingOptionTypeInputSchema,
} from "./shipping-option-type";

describe("shipping option type inputs", () => {
  it("normalizes stable codes to lowercase", () => {
    expect(
      createShippingOptionTypeInputSchema.parse({
        label: "Express",
        code: "Express-Delivery",
        description: "Arrives sooner",
      }),
    ).toMatchObject({ code: "express-delivery" });
  });

  it("rejects codes that cannot be used as stable identifiers", () => {
    expect(
      createShippingOptionTypeInputSchema.safeParse({
        label: "Express",
        code: "Express delivery",
      }).success,
    ).toBe(false);
  });

  it("requires an OCC timestamp and a changed field when editing", () => {
    expect(
      updateShippingOptionTypeInputSchema.safeParse({
        id: "00000000-0000-4000-8000-000000000101",
        label: "Updated",
      }).success,
    ).toBe(false);
    expect(
      updateShippingOptionTypeInputSchema.safeParse({
        id: "00000000-0000-4000-8000-000000000101",
        expectedUpdatedAt: "2026-09-26T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});
