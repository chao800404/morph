import { describe, expect, it } from "vitest";
import {
  storeOrderTransferRequestSchema,
  storeOrderTransferTokenSchema,
} from "./store-customer";

describe("store order transfer token input", () => {
  it("accepts a 256-bit hex token", () => {
    expect(
      storeOrderTransferTokenSchema.safeParse({ token: "a".repeat(64) }).success,
    ).toBe(true);
  });

  it("rejects malformed or additional token input", () => {
    expect(
      storeOrderTransferTokenSchema.safeParse({ token: "short" }).success,
    ).toBe(false);
    expect(
      storeOrderTransferTokenSchema.safeParse({
        token: "a".repeat(64),
        customerId: "attacker-controlled",
      }).success,
    ).toBe(false);
  });
});

describe("store order transfer request input", () => {
  it("defaults the optional Medusa-compatible fields", () => {
    expect(storeOrderTransferRequestSchema.parse({})).toEqual({
      description: undefined,
      updateOrderEmail: false,
    });
    expect(
      storeOrderTransferRequestSchema.parse({
        description: "Please confirm this order transfer",
        update_order_email: true,
      }),
    ).toEqual({
      description: "Please confirm this order transfer",
      updateOrderEmail: true,
    });
    expect(
      storeOrderTransferRequestSchema.safeParse({
        update_order_email: true,
        updateOrderEmail: false,
      }).success,
    ).toBe(false);
  });

  it("rejects unknown fields", () => {
    expect(
      storeOrderTransferRequestSchema.safeParse({ customerId: "forged" })
        .success,
    ).toBe(false);
  });
});
