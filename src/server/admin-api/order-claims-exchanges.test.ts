import { describe, expect, it, vi } from "vitest";
import type {
  OrderClaimDTO,
  OrderExchangeDTO,
} from "@/lib/order/dto/order.dto";
import {
  handleAdminOrderClaimsExchangesRequest,
  type AdminOrderChangesApiDependencies,
} from "./order-claims-exchanges";

const orderId = "6fa459ea-ee8a-3ca4-894e-db77e160355e";
const claimId = "a20a3e44-0f4e-4ad0-8bd8-b78f0c5c9469";
const exchangeId = "b6cfd2d3-10d2-4eca-a27b-f6e217b0bc8c";
const itemId = "23b0ce93-fffb-4f2b-8ab2-3e87c14935f1";
const variantId = "c51fd8d1-5eb7-41b4-84f8-a7d1e6ed0998";
const locationId = "4c5b7a2e-5684-4e61-b7f1-2af5e44e623f";
const actorId = "7d7c1c28-3938-4936-bfc9-0471e5925e17";

const claim: OrderClaimDTO = {
  id: claimId,
  displayId: 7,
  returnId: null,
  returnShipping: null,
  outboundShipping: null,
  type: "refund",
  refundAmount: 2500,
  orderVersion: 4,
  createdAt: "2026-09-27T00:00:00.000Z",
  canceledAt: null,
  items: [
    {
      id: "cdf8c5a5-3be0-4834-b35d-887746e65d33",
      itemId,
      title: "Test product",
      sku: "TEST-1",
      quantity: 1,
      reason: "production_failure",
      note: null,
      isAdditionalItem: false,
    },
  ],
};

const exchange: OrderExchangeDTO = {
  id: exchangeId,
  displayId: 9,
  returnId: "fe1da0d3-74cc-4a89-aaf5-9e40ddc2c693",
  differenceDue: 100,
  allowBackorder: false,
  createdAt: "2026-09-27T00:00:00.000Z",
  canceledAt: null,
  returnStatus: "requested",
  locationName: "Main warehouse",
  returnShipping: null,
  outboundShipping: null,
  inboundItems: [
    {
      id: itemId,
      itemId,
      title: "Test product",
      sku: "TEST-1",
      quantity: 1,
      receivedQuantity: 0,
    },
  ],
  items: [
    {
      id: variantId,
      itemId: variantId,
      title: "Replacement product",
      sku: "TEST-2",
      quantity: 1,
      unitPrice: 2600,
    },
  ],
};

const dependencies = (
  overrides: Partial<AdminOrderChangesApiDependencies> = {},
): AdminOrderChangesApiDependencies => ({
  authorize: vi.fn(async () => ({ allowed: true as const, userId: actorId })),
  hasNotificationEmail: vi.fn(async () => true),
  notifyClaim: vi.fn(async () => true),
  notifyExchange: vi.fn(async () => true),
  listClaims: vi.fn(async () => [claim]),
  listExchanges: vi.fn(async () => [exchange]),
  createRefundClaim: vi.fn(async () => ({
    success: true as const,
    claimId,
    displayId: 7,
    refundAmount: 2500,
  })),
  createReplacementClaim: vi.fn(async () => ({
    success: true as const,
    claimId,
    displayId: 7,
  })),
  createExchange: vi.fn(async () => ({
    success: true as const,
    returnId: exchange.returnId!,
    displayId: exchange.displayId,
  })),
  cancelExchange: vi.fn(async () => ({
    success: true as const,
    returnId: exchange.returnId!,
  })),
  ...overrides,
});

const json = (response: Response) => response.json() as Promise<unknown>;

describe("Medusa-shaped Admin order claims and exchanges API", () => {
  it("lists claims in snake_case under the order route", async () => {
    const deps = dependencies();
    const response = await handleAdminOrderClaimsExchangesRequest(
      new Request(`https://morph.test/api/admin/orders/${orderId}/claims`),
      deps,
    );

    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({
      count: 1,
      claims: [
        {
          id: claimId,
          display_id: 7,
          order_version: 4,
          refund_amount: 2500,
          items: [{ item_id: itemId, is_additional_item: false }],
        },
      ],
    });
  });

  it("creates refund claims with the verified actor and notification preference", async () => {
    const deps = dependencies();
    const response = await handleAdminOrderClaimsExchangesRequest(
      new Request(`https://morph.test/api/admin/orders/${orderId}/claims`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "refund",
          return_location_id: locationId,
          no_notification: true,
          claim_items: [
            { item_id: itemId, quantity: 1, reason: "production_failure" },
          ],
        }),
      }),
      deps,
    );

    expect(response.status).toBe(201);
    expect(deps.createRefundClaim).toHaveBeenCalledWith({
      orderId,
      locationId,
      returnItems: true,
      sendNotification: false,
      items: [
        {
          itemId,
          quantity: 1,
          reason: "production_failure",
        },
      ],
      createdBy: actorId,
    });
    expect(deps.notifyClaim).not.toHaveBeenCalled();
    expect(await json(response)).toMatchObject({
      claim: { id: claimId, type: "refund" },
    });
  });

  it("requires a location before creating a replacement claim", async () => {
    const deps = dependencies();
    const response = await handleAdminOrderClaimsExchangesRequest(
      new Request(`https://morph.test/api/admin/orders/${orderId}/claims`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "replace",
          additional_items: [{ variant_id: variantId, quantity: 1 }],
        }),
      }),
      deps,
    );

    expect(response.status).toBe(400);
    expect(deps.createReplacementClaim).not.toHaveBeenCalled();
  });

  it("keeps a committed claim response successful if its follow-up read fails", async () => {
    const deps = dependencies({
      listClaims: vi.fn(async () => {
        throw new Error("temporary D1 read failure");
      }),
    });
    const response = await handleAdminOrderClaimsExchangesRequest(
      new Request(`https://morph.test/api/admin/orders/${orderId}/claims`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "refund",
          return_location_id: locationId,
          no_notification: true,
          claim_items: [{ item_id: itemId, quantity: 1 }],
        }),
      }),
      deps,
    );

    expect(response.status).toBe(201);
    expect(await json(response)).toMatchObject({
      claim: { id: claimId, display_id: 7, type: "refund" },
    });
  });

  it("creates exchanges and notifies only after checking the order email", async () => {
    const deps = dependencies();
    const response = await handleAdminOrderClaimsExchangesRequest(
      new Request(`https://morph.test/api/admin/orders/${orderId}/exchanges`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          location_id: locationId,
          items: [{ item_id: itemId, variant_id: variantId, quantity: 1 }],
        }),
      }),
      deps,
    );

    expect(response.status).toBe(201);
    expect(deps.hasNotificationEmail).toHaveBeenCalledWith(orderId);
    expect(deps.createExchange).toHaveBeenCalledWith({
      orderId,
      locationId,
      allowBackorder: false,
      carryOverPromotions: false,
      sendNotification: true,
      items: [{ itemId, variantId, quantity: 1 }],
      createdBy: actorId,
    });
    expect(deps.notifyExchange).toHaveBeenCalledWith({
      orderId,
      returnId: exchange.returnId,
    });
    expect(await json(response)).toMatchObject({
      exchange: { id: exchangeId, difference_due: 100 },
      notification_sent: true,
    });
  });

  it("cancels only the exchange belonging to the order path", async () => {
    const deps = dependencies();
    const response = await handleAdminOrderClaimsExchangesRequest(
      new Request(
        `https://morph.test/api/admin/orders/${orderId}/exchanges/${exchangeId}/cancel`,
        { method: "POST" },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.cancelExchange).toHaveBeenCalledWith({
      orderId,
      exchangeId,
      canceledBy: actorId,
    });
    expect(await json(response)).toMatchObject({
      exchange: { id: exchangeId },
    });
  });
});
