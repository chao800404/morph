import {
  cancelOrder,
  captureOrderPayment,
  createOrderFulfillment,
  refundOrderPayment,
} from "@/server/marketing/order-workflow.serverFn";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelOrderAction,
  captureOrderPaymentAction,
  createOrderFulfillmentAction,
  refundOrderPaymentAction,
} from "./order-workflow-actions";

vi.mock("@/server/marketing/order-workflow.serverFn", () => ({
  cancelOrder: vi.fn(),
  cancelOrderFulfillment: vi.fn(),
  captureOrderPayment: vi.fn(),
  createOrderFulfillment: vi.fn(),
  markOrderFulfillmentDelivered: vi.fn(),
  markOrderFulfillmentShipped: vi.fn(),
  refundOrderPayment: vi.fn(),
}));

describe("order workflow form actions", () => {
  beforeEach(() => {
    vi.mocked(cancelOrder).mockResolvedValue({
      success: true,
      message: "Done",
      data: { orderId: "11111111-1111-4111-8111-111111111111" },
    });
    vi.mocked(captureOrderPayment).mockResolvedValue({
      success: true,
      message: "Done",
      data: { success: true, amount: 2500 },
    });
    vi.mocked(createOrderFulfillment).mockResolvedValue({
      success: true,
      message: "Done",
      data: {
        success: true,
        fulfillmentId: "55555555-5555-4555-8555-555555555555",
      },
    });
    vi.mocked(refundOrderPayment).mockResolvedValue({
      success: true,
      message: "Done",
      data: { success: true, amount: 1000 },
    });
  });

  it("maps payment capture and refund inputs to validated server functions", async () => {
    const capture = new FormData();
    capture.set("orderId", "11111111-1111-4111-8111-111111111111");
    capture.set("amount", "2500");
    await captureOrderPaymentAction({ data: capture });
    expect(captureOrderPayment).toHaveBeenCalledWith({
      data: {
        orderId: "11111111-1111-4111-8111-111111111111",
        amount: 2500,
      },
    });

    const refund = new FormData();
    refund.set("orderId", "11111111-1111-4111-8111-111111111111");
    refund.set("amount", "1000");
    refund.set("note", "Customer request");
    await refundOrderPaymentAction({}, refund);
    expect(refundOrderPayment).toHaveBeenCalledWith({
      data: {
        orderId: "11111111-1111-4111-8111-111111111111",
        amount: 1000,
        note: "Customer request",
      },
    });
  });

  it("omits zero-quantity lines from a fulfillment", async () => {
    const data = new FormData();
    data.set("orderId", "11111111-1111-4111-8111-111111111111");
    data.set("locationId", "22222222-2222-4222-8222-222222222222");
    data.append("itemId", "33333333-3333-4333-8333-333333333333");
    data.append("itemId", "44444444-4444-4444-8444-444444444444");
    data.set("quantity:33333333-3333-4333-8333-333333333333", "2");
    data.set("quantity:44444444-4444-4444-8444-444444444444", "0");
    await createOrderFulfillmentAction({}, data);
    expect(createOrderFulfillment).toHaveBeenCalledWith({
      data: {
        orderId: "11111111-1111-4111-8111-111111111111",
        locationId: "22222222-2222-4222-8222-222222222222",
        items: [
          {
            itemId: "33333333-3333-4333-8333-333333333333",
            quantity: 2,
          },
        ],
      },
    });
  });

  it("maps order cancellation without exposing additional fields", async () => {
    const data = new FormData();
    data.set("orderId", "11111111-1111-4111-8111-111111111111");
    await cancelOrderAction({ data });
    expect(cancelOrder).toHaveBeenCalledWith({
      data: { orderId: "11111111-1111-4111-8111-111111111111" },
    });
  });
});
