import { describe, expect, it } from "vitest";

import { manualPaymentProvider } from "./manual-payment-provider";

const input = {
  amount: 1_000,
  currencyCode: "usd",
  context: { cartId: "cart" },
  data: {},
};

describe("manualPaymentProvider", () => {
  it("initiates a pending payment and authorizes explicitly", async () => {
    const initiated = await manualPaymentProvider.initiate(input);
    expect(initiated.status).toBe("pending");
    expect(typeof initiated.data.reference).toBe("string");
    await expect(
      manualPaymentProvider.authorize({ ...input, data: initiated.data }),
    ).resolves.toMatchObject({ status: "authorized" });
  });

  it("supports capture, refund, and cancellation operations", async () => {
    await expect(manualPaymentProvider.capture(input)).resolves.toMatchObject({
      status: "captured",
    });
    await expect(manualPaymentProvider.refund(input)).resolves.toMatchObject({
      status: "refunded",
    });
    await expect(manualPaymentProvider.cancel(input)).resolves.toMatchObject({
      status: "canceled",
    });
  });
});
