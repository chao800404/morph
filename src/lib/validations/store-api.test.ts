import { describe, expect, it } from "vitest";
import {
  productHandleSchema,
  storeContextParamsSchema,
  storeProductListParamsSchema,
} from "./store-api";

describe("store API validation", () => {
  it("normalizes bounded product pagination", () => {
    expect(
      storeProductListParamsSchema.parse({ page: "2", limit: "40" }),
    ).toEqual({ page: 2, limit: 40, order: "desc" });
  });

  it("rejects unbounded pagination and unsafe handles", () => {
    expect(
      storeProductListParamsSchema.safeParse({ limit: "101" }).success,
    ).toBe(false);
    expect(productHandleSchema.safeParse("../../draft-product").success).toBe(
      false,
    );
  });

  it("validates optional region selectors", () => {
    expect(
      storeContextParamsSchema.safeParse({ countryCode: "TW" }).success,
    ).toBe(true);
    expect(
      storeContextParamsSchema.safeParse({ countryCode: "TAI" }).success,
    ).toBe(false);
  });
});
