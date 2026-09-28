import { describe, expect, it, vi } from "vitest";
import { handleCustomerOrderAdjustmentsRequest } from "./customer-order-adjustments-request";

const customer = { id: "customer-1", email: "buyer@example.test" };
const claim = {
  id: "claim-1",
  displayId: 1,
  returnId: "return-1",
  returnShipping: null,
  outboundShipping: null,
  type: "replace" as const,
  refundAmount: null,
  orderVersion: 2,
  createdAt: "2026-09-28T00:00:00.000Z",
  canceledAt: null,
  items: [
    {
      id: "claim-item-1",
      itemId: "line-1",
      title: "Linen Shirt",
      sku: "LINEN-1",
      quantity: 1,
      reason: "wrong_item" as const,
      note: "internal note",
      isAdditionalItem: false,
    },
  ],
};
const exchange = {
  id: "exchange-1",
  displayId: 1,
  returnId: "return-1",
  differenceDue: 9000,
  allowBackorder: false,
  createdAt: "2026-09-28T00:00:00.000Z",
  canceledAt: null,
  returnStatus: "requested" as const,
  locationName: "Internal warehouse",
  returnShipping: null,
  outboundShipping: null,
  inboundItems: [
    {
      id: "inbound-1",
      itemId: "line-1",
      title: "Linen Shirt",
      sku: "LINEN-1",
      quantity: 1,
      receivedQuantity: 0,
    },
  ],
  items: [
    {
      id: "outbound-1",
      itemId: "line-2",
      title: "Linen Shirt, Size M",
      sku: "LINEN-M",
      quantity: 1,
      unitPrice: 9800,
    },
  ],
};

const dependencies = () => ({
  findOwnedOrder: vi.fn(async (): Promise<{ id: string } | null> => ({ id: "order-1" })),
  listClaims: vi.fn(async () => [claim]),
  listExchanges: vi.fn(async () => [exchange]),
});

describe("customer order adjustment reads", () => {
  it("checks order ownership before reading claims and returns customer-safe fields", async () => {
    const deps = dependencies();
    const response = await handleCustomerOrderAdjustmentsRequest(
      "GET",
      "customers/me/orders/order-1/claims",
      { customer, salesChannelId: "channel-1" },
      deps,
    );

    expect(deps.findOwnedOrder).toHaveBeenCalledWith({
      orderId: "order-1",
      customerId: customer.id,
      email: customer.email,
      salesChannelId: "channel-1",
    });
    expect(deps.listClaims).toHaveBeenCalledWith("order-1");
    expect(deps.listExchanges).not.toHaveBeenCalled();
    expect(response?.headers.get("access-control-allow-origin")).toBe("*");
    expect(response?.headers.get("cache-control")).toBe("private, no-store");
    expect(await response?.json()).toEqual({
      claims: [
        {
          id: "claim-1",
          displayId: 1,
          type: "replace",
          returnId: "return-1",
          createdAt: "2026-09-28T00:00:00.000Z",
          canceledAt: null,
          items: [
            {
              id: "claim-item-1",
              title: "Linen Shirt",
              sku: "LINEN-1",
              quantity: 1,
              reason: "wrong_item",
              isAdditionalItem: false,
            },
          ],
        },
      ],
    });
  });

  it("hides exchanges for orders the customer does not own", async () => {
    const deps = dependencies();
    deps.findOwnedOrder.mockResolvedValue(null);
    const response = await handleCustomerOrderAdjustmentsRequest(
      "GET",
      "customers/me/orders/order-1/exchanges",
      { customer, salesChannelId: "channel-1" },
      deps,
    );

    expect(response?.status).toBe(404);
    expect(deps.listExchanges).not.toHaveBeenCalled();
  });

  it("returns exchange progress without warehouse or balance details", async () => {
    const deps = dependencies();
    const response = await handleCustomerOrderAdjustmentsRequest(
      "GET",
      "customers/me/orders/order-1/exchanges",
      { customer, salesChannelId: "channel-1" },
      deps,
    );

    expect(response?.status).toBe(200);
    const payload = await response?.json();
    expect(payload).toMatchObject({
      exchanges: [
        {
          id: "exchange-1",
          displayId: 1,
          returnStatus: "requested",
          inboundItems: [{ title: "Linen Shirt", receivedQuantity: 0 }],
          items: [{ title: "Linen Shirt, Size M", quantity: 1 }],
        },
      ],
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("Internal warehouse");
    expect(serialized).not.toContain("differenceDue");
    expect(serialized).not.toContain("unitPrice");
  });

  it("does not match unrelated paths or write methods", async () => {
    const deps = dependencies();
    const wrongMethod = await handleCustomerOrderAdjustmentsRequest(
      "POST",
      "customers/me/orders/order-1/claims",
      { customer, salesChannelId: "channel-1" },
      deps,
    );
    const wrongPath = await handleCustomerOrderAdjustmentsRequest(
      "GET",
      "customers/me/orders/order-1/refunds",
      { customer, salesChannelId: "channel-1" },
      deps,
    );

    expect(wrongMethod).toBeNull();
    expect(wrongPath).toBeNull();
    expect(deps.findOwnedOrder).not.toHaveBeenCalled();
  });
});
