import { describe, expect, it } from "vitest";

import { manualFulfillmentProvider } from "./manual-fulfillment-provider";

describe("manualFulfillmentProvider", () => {
  it("creates a traceable manual fulfillment", async () => {
    const data = await manualFulfillmentProvider.create({
      orderId: "order",
      fulfillmentId: "fulfillment",
      locationId: "location",
      shippingOptionId: null,
      currencyCode: "twd",
      address: null,
      items: [],
      data: {},
    });
    expect(typeof data.data.reference).toBe("string");
    expect(data.labels).toEqual([]);
  });

  it("preserves provider data when canceled", async () => {
    await expect(
      manualFulfillmentProvider.cancel({
        orderId: "order",
        fulfillmentId: "fulfillment",
        data: { reference: "manual" },
      }),
    ).resolves.toEqual({ reference: "manual" });
  });
});
