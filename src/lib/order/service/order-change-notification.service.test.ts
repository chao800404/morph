import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  sendOrderClaimCreatedEmail,
  sendOrderExchangeCreatedEmail,
} from "@/lib/email";
import { orderReturnDal } from "@/lib/order/dal/order-return.dal";
import { orderDal } from "@/lib/order/dal/order.dal";
import {
  notifyOrderClaimCreated,
  notifyOrderExchangeCreated,
} from "./order-change-notification.service";

vi.mock("@/lib/email", () => ({
  sendOrderClaimCreatedEmail: vi.fn(),
  sendOrderExchangeCreatedEmail: vi.fn(),
}));
vi.mock("@/lib/order/dal/order-return.dal", () => ({
  orderReturnDal: {
    listClaims: vi.fn(),
    listExchanges: vi.fn(),
  },
}));
vi.mock("@/lib/order/dal/order.dal", () => ({
  orderDal: { findById: vi.fn() },
}));

const orderId = "6fa459ea-ee8e-3ca4-894e-db77e160355e";
const claimId = "a20a3e44-0f4e-4ad0-8bd8-b78f0c5c9469";
const returnId = "b6cfd2d3-10d2-4eca-a27b-f6e217b0bc8c";
const order = {
  id: orderId,
  customerId: "db6c75d0-3bdd-4307-87e7-5b2fbf8a32b8",
  email: "customer@example.com",
  currencyCode: "usd",
  displayId: 42,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(orderDal.findById).mockResolvedValue(order as never);
  vi.mocked(sendOrderClaimCreatedEmail).mockResolvedValue({ success: true });
  vi.mocked(sendOrderExchangeCreatedEmail).mockResolvedValue({ success: true });
});

describe("order change notifications", () => {
  it("sends claim notifications with their durable resource and idempotency IDs", async () => {
    vi.mocked(orderReturnDal.listClaims).mockResolvedValue([
      {
        id: claimId,
        displayId: 7,
        returnId: null,
        refundAmount: 2500,
        items: [
          {
            title: "Test product",
            sku: "TEST-1",
            quantity: 1,
            isAdditionalItem: false,
          },
        ],
        returnShipping: null,
        outboundShipping: null,
      } as never,
    ] as never);

    await expect(
      notifyOrderClaimCreated({ orderId, claimId, type: "refund" }),
    ).resolves.toBe(true);

    expect(sendOrderClaimCreatedEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        email: order.email,
        orderId,
        customerId: order.customerId,
        claimId,
        claimType: "refund",
      }),
    );
  });

  it("sends exchange notifications with the return ID used as the idempotency key", async () => {
    vi.mocked(orderReturnDal.listExchanges).mockResolvedValue([
      {
        returnId,
        displayId: 9,
        differenceDue: 100,
        inboundItems: [],
        items: [],
        returnShipping: null,
        outboundShipping: null,
      } as never,
    ] as never);

    await expect(
      notifyOrderExchangeCreated({ orderId, returnId }),
    ).resolves.toBe(true);

    expect(sendOrderExchangeCreatedEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        email: order.email,
        orderId,
        customerId: order.customerId,
        returnId,
      }),
    );
  });
});
