import { describe, expect, it } from "vitest";
import {
  toStoreCustomerClaim,
  toStoreCustomerExchange,
} from "./customer-order-adjustment.dto";

describe("storefront customer order adjustment DTOs", () => {
  it("exposes claim progress without internal notes or refund amounts", () => {
    const claim = toStoreCustomerClaim({
      id: "claim-1",
      displayId: 4,
      returnId: "return-1",
      returnShipping: { name: "Internal return rate", amount: 800 },
      outboundShipping: null,
      type: "refund",
      refundAmount: 12500,
      orderVersion: 3,
      createdAt: "2026-09-28T00:00:00.000Z",
      canceledAt: null,
      items: [
        {
          id: "claim-item-1",
          itemId: "line-1",
          title: "Linen Shirt",
          sku: "LINEN-1",
          quantity: 1,
          reason: "wrong_item",
          note: "Internal inspection note",
          isAdditionalItem: false,
        },
      ],
    });

    expect(claim).toEqual({
      id: "claim-1",
      displayId: 4,
      type: "refund",
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
    });
  });

  it("exposes exchange item and return progress without internal fulfillment or balance fields", () => {
    const exchange = toStoreCustomerExchange({
      id: "exchange-1",
      displayId: 2,
      returnId: "return-2",
      differenceDue: 2500,
      allowBackorder: true,
      createdAt: "2026-09-28T00:00:00.000Z",
      canceledAt: null,
      returnStatus: "requested",
      locationName: "Warehouse North",
      returnShipping: { name: "Internal return rate", amount: 800 },
      outboundShipping: { name: "Internal outbound rate", amount: 600 },
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
    });

    expect(exchange).toEqual({
      id: "exchange-1",
      displayId: 2,
      returnId: "return-2",
      createdAt: "2026-09-28T00:00:00.000Z",
      canceledAt: null,
      returnStatus: "requested",
      inboundItems: [
        {
          id: "inbound-1",
          title: "Linen Shirt",
          sku: "LINEN-1",
          quantity: 1,
          receivedQuantity: 0,
        },
      ],
      items: [
        {
          id: "outbound-1",
          title: "Linen Shirt, Size M",
          sku: "LINEN-M",
          quantity: 1,
        },
      ],
    });
  });
});
