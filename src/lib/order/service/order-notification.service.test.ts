import { beforeEach, describe, expect, it, vi } from "vitest";
import { retryOrderPlacedEmail, sendOrderPlacedEmail } from "@/lib/email";
import { orderDal } from "@/lib/order/dal/order.dal";
import { notificationDal } from "@/lib/notification/dal/notification.dal";
import { giftCardDal } from "@/lib/gift-card/dal/gift-card.dal";
import {
  convertDraftOrderAndNotifyCustomer,
  notifyOrderPlaced,
  retryFailedOrderPlacedNotification,
} from "./order-notification.service";

vi.mock("@/lib/email", () => ({
  sendOrderPlacedEmail: vi.fn(),
  retryOrderPlacedEmail: vi.fn(),
}));
vi.mock("@/lib/gift-card/dal/gift-card.dal", () => ({
  giftCardDal: { listForOrder: vi.fn() },
}));
vi.mock("@/lib/notification/dal/notification.dal", () => ({
  notificationDal: { findRetryableOrderPlaced: vi.fn() },
}));
vi.mock("@/lib/order/dal/order.dal", () => ({
  orderDal: {
    findById: vi.fn(),
    listItemsPage: vi.fn(),
    convertDraftToOrder: vi.fn(),
  },
}));

const orderId = "6fa459ea-ee8e-3ca4-894e-db77e160355e";
const order = {
  id: orderId,
  displayId: 42,
  status: "pending",
  email: "buyer@example.com",
  currencyCode: "usd",
  isDraftOrder: false,
  noNotification: false,
  customerId: "db6c75d0-3bdd-4307-87e7-5b2fbf8a32b8",
  version: 3,
  total: 5998,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(orderDal.findById).mockResolvedValue(order as never);
  vi.mocked(orderDal.listItemsPage).mockResolvedValue({
    items: [
      {
        id: "item-1",
        title: "Linen shirt",
        sku: "LINEN-1",
        quantity: 2,
        unitPrice: 2499,
      },
    ],
    total: 1,
  } as never);
  vi.mocked(sendOrderPlacedEmail).mockResolvedValue({ success: true });
  vi.mocked(retryOrderPlacedEmail).mockResolvedValue({ success: true });
  vi.mocked(notificationDal.findRetryableOrderPlaced).mockResolvedValue(null);
  vi.mocked(orderDal.convertDraftToOrder).mockResolvedValue({
    success: true,
  } as never);
});

describe("order placed notification", () => {
  it("delivers only cards issued for this order", async () => {
    vi.mocked(orderDal.listItemsPage).mockResolvedValue({
      items: [
        {
          id: "gift-line",
          title: "Gift card",
          quantity: 1,
          unitPrice: 2500,
          sku: null,
          isGiftcard: true,
        },
      ],
      total: 1,
    } as never);
    const cards = [
      { code: "GIFT-TEST", value: 2500, currencyCode: "usd", expiresAt: null },
    ];
    vi.mocked(giftCardDal.listForOrder).mockResolvedValue(cards);
    expect(await notifyOrderPlaced({ orderId })).toBe(true);
    expect(giftCardDal.listForOrder).toHaveBeenCalledWith(orderId);
    expect(sendOrderPlacedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ giftCards: cards }),
    );
  });

  it("sends the order snapshot and pages at its original version", async () => {
    await expect(notifyOrderPlaced({ orderId })).resolves.toBe(true);

    expect(orderDal.listItemsPage).toHaveBeenCalledWith({
      orderId,
      page: 1,
      limit: 100,
      version: order.version,
    });
    expect(sendOrderPlacedEmail).toHaveBeenCalledWith({
      email: order.email,
      orderId,
      customerId: order.customerId,
      currencyCode: order.currencyCode,
      orderDisplayId: order.displayId,
      items: [
        {
          title: "Linen shirt",
          sku: "LINEN-1",
          quantity: 2,
          unitPrice: 2499,
        },
      ],
      total: order.total,
    });
  });

  it("loads every order line in pages before sending", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: `item-${index}`,
      title: `Product ${index}`,
      sku: null,
      quantity: 1,
      unitPrice: 100,
    }));
    vi.mocked(orderDal.listItemsPage)
      .mockResolvedValueOnce({ items: firstPage, total: 101 } as never)
      .mockResolvedValueOnce({
        items: [
          {
            id: "item-100",
            title: "Product 100",
            sku: null,
            quantity: 1,
            unitPrice: 100,
          },
        ],
        total: 101,
      } as never);

    await expect(notifyOrderPlaced({ orderId })).resolves.toBe(true);

    expect(orderDal.listItemsPage).toHaveBeenCalledTimes(2);
    expect(
      vi.mocked(sendOrderPlacedEmail).mock.calls[0]?.[0].items,
    ).toHaveLength(101);
  });

  it.each([
    ["draft", { ...order, isDraftOrder: true }],
    ["canceled", { ...order, status: "canceled" }],
    ["suppressed", { ...order, noNotification: true }],
    ["without an address", { ...order, email: null }],
  ])("does not notify an order that is %s", async (_reason, value) => {
    vi.mocked(orderDal.findById).mockResolvedValue(value as never);

    await expect(notifyOrderPlaced({ orderId })).resolves.toBe(false);
    expect(orderDal.listItemsPage).not.toHaveBeenCalled();
    expect(sendOrderPlacedEmail).not.toHaveBeenCalled();
  });

  it("does not fail the order operation if reading or sending fails", async () => {
    vi.mocked(orderDal.listItemsPage).mockRejectedValue(
      new Error("D1 offline"),
    );

    await expect(notifyOrderPlaced({ orderId })).resolves.toBe(false);
    expect(sendOrderPlacedEmail).not.toHaveBeenCalled();
  });

  it("does not send a partial order if a page makes no progress", async () => {
    vi.mocked(orderDal.listItemsPage).mockResolvedValue({
      items: [],
      total: 1,
    } as never);

    await expect(notifyOrderPlaced({ orderId })).resolves.toBe(false);

    expect(sendOrderPlacedEmail).not.toHaveBeenCalled();
  });

  it("keeps order placement bounded when the snapshot is too large to email", async () => {
    vi.mocked(orderDal.listItemsPage).mockResolvedValue({
      items: [],
      total: 501,
    } as never);

    await expect(notifyOrderPlaced({ orderId })).resolves.toBe(false);

    expect(orderDal.listItemsPage).toHaveBeenCalledTimes(1);
    expect(sendOrderPlacedEmail).not.toHaveBeenCalled();
  });

  it("retries only an eligible notification using its stored recipient and content", async () => {
    const savedNotification = {
      id: "notification-123",
      to: "original@example.com",
      receiverId: "original-customer",
      data: {
        appName: "Morph",
        orderDisplayId: 42,
        items: [],
        total: "$59.98",
      },
      status: "failure",
    };
    vi.mocked(notificationDal.findRetryableOrderPlaced).mockResolvedValue(
      savedNotification as never,
    );

    await expect(
      retryFailedOrderPlacedNotification({
        orderId,
        notificationId: savedNotification.id,
      }),
    ).resolves.toEqual({ success: true });

    expect(retryOrderPlacedEmail).toHaveBeenCalledWith({
      email: savedNotification.to,
      orderId,
      customerId: "original-customer",
      notificationId: savedNotification.id,
      data: savedNotification.data,
    });
  });

  it.each([
    ["not found", null],
    ["canceled", { ...order, status: "canceled" }],
    ["suppressed", { ...order, noNotification: true }],
  ])("does not resend when the order is %s", async (_reason, value) => {
    vi.mocked(orderDal.findById).mockResolvedValue(value as never);
    vi.mocked(notificationDal.findRetryableOrderPlaced).mockResolvedValue({
      id: "notification-123",
      to: "buyer@example.com",
      data: { appName: "Morph" },
    } as never);

    await expect(
      retryFailedOrderPlacedNotification({
        orderId,
        notificationId: "notification-123",
      }),
    ).resolves.toMatchObject({ success: false, reason: "NOT_RETRYABLE" });

    expect(retryOrderPlacedEmail).not.toHaveBeenCalled();
  });

  it("does not resend a notification that is no longer eligible", async () => {
    await expect(
      retryFailedOrderPlacedNotification({
        orderId,
        notificationId: "notification-123",
      }),
    ).resolves.toMatchObject({ success: false, reason: "NOT_RETRYABLE" });

    expect(retryOrderPlacedEmail).not.toHaveBeenCalled();
  });

  it("reports an email-provider failure separately from an ineligible retry", async () => {
    vi.mocked(notificationDal.findRetryableOrderPlaced).mockResolvedValue({
      id: "notification-123",
      to: "buyer@example.com",
      receiverId: order.customerId,
      data: {
        appName: "Morph",
        orderDisplayId: 42,
        items: [],
        total: "$59.98",
      },
    } as never);
    vi.mocked(retryOrderPlacedEmail).mockResolvedValue({
      success: false,
      error: "provider unavailable",
    });

    await expect(
      retryFailedOrderPlacedNotification({
        orderId,
        notificationId: "notification-123",
      }),
    ).resolves.toEqual({ success: false, reason: "DELIVERY_FAILED" });
  });

  it("sends the same confirmation after a successful draft conversion", async () => {
    await expect(convertDraftOrderAndNotifyCustomer(orderId)).resolves.toEqual({
      success: true,
    });

    expect(orderDal.convertDraftToOrder).toHaveBeenCalledWith(orderId);
    expect(sendOrderPlacedEmail).toHaveBeenCalledTimes(1);
  });

  it("does not notify when the draft conversion did not commit", async () => {
    vi.mocked(orderDal.convertDraftToOrder).mockResolvedValue({
      success: false,
      reason: "CONFLICT",
    } as never);

    await convertDraftOrderAndNotifyCustomer(orderId);

    expect(orderDal.findById).not.toHaveBeenCalled();
    expect(sendOrderPlacedEmail).not.toHaveBeenCalled();
  });
});
