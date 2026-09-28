import { beforeEach, describe, expect, it, vi } from "vitest";
import { getConfig } from "@/server/get-config";
import {
  sendAuthVerificationEmail,
  sendOrderClaimCreatedEmail,
  sendOrderExchangeCreatedEmail,
  sendOrderPlacedEmail,
  sendPasswordResetEmail,
  retryOrderPlacedEmail,
} from "./index";
import { sendEmailNotification } from "@/lib/notification/service/email-notification.service";

vi.mock("@/server/get-config", () => ({
  getConfig: vi.fn(),
}));
vi.mock("@/lib/notification/service/email-notification.service", () => ({
  sendEmailNotification: vi.fn(
    (input: {
      adapter: { send: (params: never) => Promise<unknown> };
      params: never;
    }) => input.adapter.send(input.params),
  ),
}));

describe("authentication email delivery", () => {
  const send = vi.fn();

  beforeEach(() => {
    send.mockReset();
    vi.mocked(getConfig).mockReturnValue({
      server: {
        appName: "Morph",
        email: { send },
      },
    } as never);
  });

  it("sends sign-in OTP through the configured adapter", async () => {
    send.mockResolvedValue({ success: true, messageId: "message-1" });

    await expect(
      sendAuthVerificationEmail({
        email: "member@example.com",
        otp: "123456",
        type: "sign-in",
      }),
    ).resolves.toMatchObject({ success: true });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "member@example.com",
        subject: "Your sign-in code for Morph",
        html: expect.stringContaining("123456"),
      }),
    );
  });

  it("sends email-verification OTP with a verification subject", async () => {
    send.mockResolvedValue({ success: true });

    await sendAuthVerificationEmail({
      email: "member@example.com",
      otp: "654321",
      type: "email-verification",
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Verify your email for Morph",
        html: expect.stringContaining("654321"),
      }),
    );
  });

  it("fails closed without exposing recipient or OTP when the adapter fails", async () => {
    send.mockResolvedValue({
      success: false,
      error: "provider rejected request",
    });

    const error = await sendAuthVerificationEmail({
      email: "member@example.com",
      otp: "123456",
      type: "sign-in",
    }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Authentication email could not be sent.",
    );
    expect((error as Error).message).not.toContain("member@example.com");
    expect((error as Error).message).not.toContain("123456");
  });

  it("keeps password reset delivery fail-closed", async () => {
    send.mockResolvedValue({ success: false, error: "provider unavailable" });

    await expect(
      sendPasswordResetEmail({
        email: "member@example.com",
        otp: "123456",
      }),
    ).rejects.toThrow("Password reset email could not be sent.");
  });
});

describe("order exchange email delivery", () => {
  const send = vi.fn();

  beforeEach(() => {
    send.mockReset();
    vi.mocked(getConfig).mockReturnValue({
      server: {
        appName: "Morph",
        email: { send },
      },
    } as never);
  });

  it("sends the exchange summary with currency-aware amounts", async () => {
    send.mockResolvedValue({ success: true, messageId: "message-exchange" });

    const result = await sendOrderExchangeCreatedEmail({
      email: "buyer@example.com",
      currencyCode: "usd",
      orderDisplayId: 42,
      exchangeDisplayId: 3,
      differenceDue: 1234,
      inboundItems: [{ title: "Old shirt", sku: "OLD-1", quantity: 1 }],
      outboundItems: [
        { title: "New shirt", sku: "NEW-1", quantity: 2, unitPrice: 2499 },
      ],
      returnShipping: { name: "Return delivery", amount: 500 },
      outboundShipping: null,
    });

    expect(result).toMatchObject({ success: true });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "buyer@example.com",
        subject: "Exchange #3 confirmed for order #42",
        html: expect.stringContaining("Your exchange is confirmed"),
      }),
    );
    const html = send.mock.calls[0][0].html as string;
    expect(html).toContain("Old shirt");
    expect(html).toContain("New shirt");
    expect(html).toContain("12.34");
    expect(html).toContain("24.99");
  });

  it("returns a failed delivery result without throwing after a provider failure", async () => {
    send.mockResolvedValue({ success: false, error: "provider unavailable" });

    await expect(
      sendOrderExchangeCreatedEmail({
        email: "buyer@example.com",
        currencyCode: "usd",
        orderDisplayId: 42,
        exchangeDisplayId: 3,
        differenceDue: 0,
        inboundItems: [],
        outboundItems: [],
        returnShipping: null,
        outboundShipping: null,
      }),
    ).resolves.toMatchObject({ success: false });
  });
});

describe("order placed email delivery", () => {
  const send = vi.fn();

  beforeEach(() => {
    send.mockReset();
    vi.mocked(sendEmailNotification).mockClear();
    vi.mocked(getConfig).mockReturnValue({
      server: {
        appName: "Morph",
        email: { id: "resend", send },
      },
    } as never);
  });

  it("sends a currency-aware order summary with a stable placed-event key", async () => {
    send.mockResolvedValue({ success: true, messageId: "message-order" });

    const result = await sendOrderPlacedEmail({
      email: "buyer@example.com",
      orderId: "order-123",
      customerId: "customer-123",
      currencyCode: "usd",
      orderDisplayId: 42,
      items: [
        { title: "Linen shirt", sku: "LINEN-1", quantity: 2, unitPrice: 2499 },
      ],
      total: 5998,
    });

    expect(result).toMatchObject({ success: true });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "buyer@example.com",
        subject: "Order #42 confirmed",
        html: expect.stringContaining("Your order is confirmed"),
      }),
    );
    const html = send.mock.calls[0][0].html as string;
    // React Email renders text nodes separately, so the intervening whitespace
    // may be represented by markup comments in the serialized HTML.
    expect(html).toContain("Linen shirt");
    expect(html).toContain("LINEN-1");
    expect(html).toContain("24.99");
    expect(html).toContain("59.98");
    expect(sendEmailNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        record: expect.objectContaining({
          template: "order-placed",
          triggerType: "order.placed",
          resourceType: "order",
          resourceId: "order-123",
          receiverId: "customer-123",
          idempotencyKey: "order-placed:order-123",
          adapterId: "resend",
          data: expect.objectContaining({
            appName: "Morph",
            orderDisplayId: 42,
            total: expect.any(String),
          }),
        }),
      }),
    );
  });

  it("retries a stored order confirmation with its original content and unique key", async () => {
    send.mockResolvedValue({ success: true, messageId: "message-retry" });
    const data = {
      appName: "Morph",
      orderDisplayId: 42,
      items: [
        {
          title: "Linen shirt",
          sku: "LINEN-1",
          quantity: 2,
          unitPrice: "$24.99",
        },
      ],
      total: "$59.98",
    };

    await expect(
      retryOrderPlacedEmail({
        email: "buyer@example.com",
        orderId: "order-123",
        customerId: "customer-123",
        notificationId: "notification-original",
        data,
      }),
    ).resolves.toMatchObject({ success: true });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "buyer@example.com",
        subject: "Order #42 confirmed",
        html: expect.stringContaining("Linen shirt"),
      }),
    );
    expect(sendEmailNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        record: expect.objectContaining({
          originalNotificationId: "notification-original",
          idempotencyKey: "order-placed-retry:notification-original",
          data,
        }),
      }),
    );
  });

  it("does not send a retry when the saved template data is invalid", async () => {
    await expect(
      retryOrderPlacedEmail({
        email: "buyer@example.com",
        orderId: "order-123",
        customerId: null,
        notificationId: "notification-original",
        data: { html: "untrusted" },
      }),
    ).resolves.toMatchObject({ success: false });

    expect(send).not.toHaveBeenCalled();
    expect(sendEmailNotification).not.toHaveBeenCalled();
  });

  it("reports provider failure without turning a placed order into an exception", async () => {
    send.mockResolvedValue({ success: false, error: "provider unavailable" });

    await expect(
      sendOrderPlacedEmail({
        email: "buyer@example.com",
        orderId: "order-123",
        customerId: null,
        currencyCode: "twd",
        orderDisplayId: 42,
        items: [],
        total: 1200,
      }),
    ).resolves.toMatchObject({ success: false });
  });
});

describe("order claim email delivery", () => {
  const send = vi.fn();

  beforeEach(() => {
    send.mockReset();
    vi.mocked(getConfig).mockReturnValue({
      server: {
        appName: "Morph",
        email: { send },
      },
    } as never);
  });

  it("sends a refund claim amount without suggesting that payment was processed", async () => {
    send.mockResolvedValue({ success: true, messageId: "message-claim" });

    const result = await sendOrderClaimCreatedEmail({
      email: "buyer@example.com",
      currencyCode: "usd",
      orderDisplayId: 42,
      claimDisplayId: 5,
      claimType: "refund",
      requiresReturn: false,
      refundAmount: 1234,
      inboundItems: [{ title: "Missing shirt", sku: "SHIRT-1", quantity: 1 }],
      outboundItems: [],
      returnShipping: null,
      outboundShipping: null,
    });

    expect(result).toMatchObject({ success: true });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "buyer@example.com",
        subject: "Refund claim #5 recorded for order #42",
      }),
    );
    const html = send.mock.calls[0][0].html as string;
    expect(html).toContain("Your refund claim is recorded");
    expect(html).toContain("Items covered by this claim");
    expect(html).toContain("12.34");
    expect(html).toContain("No payment refund has been processed");
    expect(html).not.toContain("Replacement items");
  });
});
