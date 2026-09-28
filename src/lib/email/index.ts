import { getConfig } from "@/server/get-config";
import type { EmailAdapter, SendEmailParams, SendEmailResult } from "./types";
import AuthOtpEmail from "./templates/auth-otp";
import OrderExchangeCreatedEmail from "./templates/order-exchange-created";
import OrderClaimCreatedEmail from "./templates/order-claim-created";
import OrderTransferRequestedEmail from "./templates/order-transfer-requested";
import OrderPlacedEmail from "./templates/order-placed";
import { findCurrency } from "@/lib/currency/catalog";
import { sendEmailNotification } from "@/lib/notification/service/email-notification.service";
import { z } from "zod";

/**
 * Get email adapter from cms.config.ts
 * @returns Email adapter instance
 * @throws Error if email is not configured
 */
function getEmailAdapter(): EmailAdapter {
  const config = getConfig();
  if (!config.server.email) {
    throw new Error(
      "Email adapter not configured. Please configure email in cms.config.ts using an adapter (e.g., resendAdapter).",
    );
  }
  return config.server.email;
}

/**
 * Send a single email
 * @param params - Email parameters
 * @returns Send result
 */
export async function sendEmail(
  params: SendEmailParams,
): Promise<SendEmailResult> {
  const adapter = getEmailAdapter();
  return adapter.send(params);
}

function sendCommerceNotificationEmail(
  params: SendEmailParams & { to: string },
  record: {
    template: string;
    triggerType: string;
    resourceType: string;
    resourceId: string | null;
    receiverId?: string | null;
    originalNotificationId?: string | null;
    idempotencyKey?: string;
    data?: import("@/db/json").Metadata | null;
  },
): Promise<SendEmailResult> {
  const adapter = getEmailAdapter();
  return sendEmailNotification({
    adapter,
    params,
    record: { ...record, adapterId: adapter.id },
  });
}

/**
 * Send multiple emails in batch
 * @param params - Array of email parameters
 * @returns Array of send results
 */
export async function sendBatchEmails(
  params: SendEmailParams[],
): Promise<SendEmailResult[]> {
  const adapter = getEmailAdapter();

  if (adapter.sendBatch) {
    return adapter.sendBatch(params);
  }

  // Fallback: Send emails one by one if adapter doesn't support batch
  return Promise.all(params.map((p) => adapter.send(p)));
}

// Export types and adapters
export * from "./adapters";
export * from "./types";

import { render } from "@react-email/components";
import PasswordResetEmail from "./templates/password-reset";
import UserInviteEmail from "./templates/user-invite";

export type AuthOtpType = "sign-in" | "email-verification";

function authOtpPurpose(type: AuthOtpType): string {
  return type === "sign-in"
    ? "sign in to your account"
    : "verify your email address";
}

/**
 * Send an OTP used for authentication or email verification.
 *
 * A failed adapter result is converted into an exception so Better Auth does
 * not report an OTP as delivered when no message was actually sent. The
 * exception is deliberately generic: neither the recipient nor the OTP may
 * enter an application log or an HTTP error response.
 */
export async function sendAuthVerificationEmail({
  email,
  otp,
  type,
}: {
  email: string;
  otp: string;
  type: AuthOtpType;
}): Promise<SendEmailResult> {
  try {
    const config = getConfig();
    const emailHtml = await render(
      AuthOtpEmail({
        appName: config.server.appName,
        otp,
        purpose: authOtpPurpose(type),
      }),
    );

    const result = await sendEmail({
      to: email,
      subject: `${type === "sign-in" ? "Your sign-in code" : "Verify your email"} for ${config.server.appName}`,
      html: emailHtml,
    });

    if (!result.success) {
      throw new Error("Authentication email could not be sent.");
    }

    return result;
  } catch {
    throw new Error("Authentication email could not be sent.");
  }
}

/**
 * Send password reset email
 * This function is used by better-auth plugin and can also be called via server function
 */
export async function sendPasswordResetEmail({
  email,
  otp,
}: {
  email: string;
  otp: string;
}) {
  try {
    const config = getConfig();
    const baseUrl = process.env.PUBLIC_URL || "http://localhost:3000";

    const emailHtml = await render(
      PasswordResetEmail({
        verificationCode: otp,
        email,
        appName: config.server.appName,
        logoUrl: `${baseUrl}/logo192.png`,
      }),
    );

    const result = await sendEmail({
      to: email,
      subject: `Reset your password for ${config.server.appName}`,
      html: emailHtml,
    });

    if (!result.success) {
      throw new Error("Password reset email could not be sent.");
    }

    return result;
  } catch {
    throw new Error("Password reset email could not be sent.");
  }
}

export async function sendUserInviteEmail({
  email,
  inviteUrl,
}: {
  email: string;
  inviteUrl: string;
}) {
  const config = getConfig();
  const emailHtml = await render(
    UserInviteEmail({ appName: config.server.appName, inviteUrl }),
  );
  return sendEmail({
    to: email,
    subject: `You have been invited to ${config.server.appName}`,
    html: emailHtml,
  });
}

export async function sendOrderExchangeCreatedEmail(input: {
  email: string;
  orderId?: string;
  customerId?: string | null;
  returnId?: string;
  currencyCode: string;
  orderDisplayId: number;
  exchangeDisplayId: number;
  differenceDue: number;
  inboundItems: Array<{
    title: string;
    sku: string | null;
    quantity: number;
  }>;
  outboundItems: Array<{
    title: string;
    sku: string | null;
    quantity: number;
    unitPrice: number;
  }>;
  returnShipping: { name: string; amount: number } | null;
  outboundShipping: { name: string; amount: number } | null;
}): Promise<SendEmailResult> {
  try {
    const config = getConfig();
    const currencyCode = input.currencyCode.toUpperCase();
    const decimalDigits = findCurrency(input.currencyCode)?.decimalDigits ?? 2;
    const formatAmount = (amount: number) =>
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currencyCode,
        minimumFractionDigits: decimalDigits,
        maximumFractionDigits: decimalDigits,
      }).format(amount / 10 ** decimalDigits);
    const html = await render(
      OrderExchangeCreatedEmail({
        appName: config.server.appName,
        orderDisplayId: input.orderDisplayId,
        exchangeDisplayId: input.exchangeDisplayId,
        inboundItems: input.inboundItems,
        outboundItems: input.outboundItems.map((item) => ({
          ...item,
          unitPrice: formatAmount(item.unitPrice),
        })),
        returnShipping: input.returnShipping
          ? {
              ...input.returnShipping,
              amount: formatAmount(input.returnShipping.amount),
            }
          : null,
        outboundShipping: input.outboundShipping
          ? {
              ...input.outboundShipping,
              amount: formatAmount(input.outboundShipping.amount),
            }
          : null,
        differenceDue: formatAmount(input.differenceDue),
      }),
    );
    return await sendCommerceNotificationEmail(
      {
        to: input.email,
        subject: `Exchange #${input.exchangeDisplayId} confirmed for order #${input.orderDisplayId}`,
        html,
      },
      {
        template: "order-exchange-created",
        triggerType: "order.exchange.created",
        resourceType: "order",
        resourceId: input.orderId ?? null,
        receiverId: input.customerId,
        ...(input.returnId
          ? { idempotencyKey: `order-exchange-created:${input.returnId}` }
          : {}),
      },
    );
  } catch {
    return {
      success: false,
      error: "Exchange notification could not be sent.",
    };
  }
}

export async function sendOrderPlacedEmail(input: {
  email: string;
  orderId: string;
  customerId: string | null;
  currencyCode: string;
  orderDisplayId: number;
  items: Array<{
    title: string;
    sku: string | null;
    quantity: number;
    unitPrice: number;
  }>;
  total: number;
}): Promise<SendEmailResult> {
  try {
    const config = getConfig();
    const currencyCode = input.currencyCode.toUpperCase();
    const decimalDigits = findCurrency(input.currencyCode)?.decimalDigits ?? 2;
    const formatAmount = (amount: number) =>
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currencyCode,
        minimumFractionDigits: decimalDigits,
        maximumFractionDigits: decimalDigits,
      }).format(amount / 10 ** decimalDigits);
    const data = {
      appName: config.server.appName,
      orderDisplayId: input.orderDisplayId,
      items: input.items.map((item) => ({
        ...item,
        unitPrice: formatAmount(item.unitPrice),
      })),
      total: formatAmount(input.total),
    };
    const html = await render(OrderPlacedEmail(data));
    return await sendCommerceNotificationEmail(
      {
        to: input.email,
        subject: `Order #${input.orderDisplayId} confirmed`,
        html,
      },
      {
        template: "order-placed",
        triggerType: "order.placed",
        resourceType: "order",
        resourceId: input.orderId,
        receiverId: input.customerId,
        idempotencyKey: `order-placed:${input.orderId}`,
        data,
      },
    );
  } catch {
    return {
      success: false,
      error: "Order confirmation could not be sent.",
    };
  }
}

const orderPlacedEmailDataSchema = z.object({
  appName: z.string().min(1).max(128),
  orderDisplayId: z.number().int().positive(),
  items: z
    .array(
      z.object({
        title: z.string().max(512),
        sku: z.string().max(128).nullable(),
        quantity: z.number().int().positive(),
        unitPrice: z.string().max(64),
      }),
    )
    .max(500),
  total: z.string().max(64),
});

/** Retry a failed order confirmation with the exact template data originally recorded. */
export async function retryOrderPlacedEmail(input: {
  email: string;
  orderId: string;
  customerId: string | null;
  notificationId: string;
  data: unknown;
}): Promise<SendEmailResult> {
  const parsed = orderPlacedEmailDataSchema.safeParse(input.data);
  if (!parsed.success) {
    return { success: false, error: "Notification data is unavailable" };
  }

  try {
    const html = await render(OrderPlacedEmail(parsed.data));
    return await sendCommerceNotificationEmail(
      {
        to: input.email,
        subject: `Order #${parsed.data.orderDisplayId} confirmed`,
        html,
      },
      {
        template: "order-placed",
        triggerType: "order.placed",
        resourceType: "order",
        resourceId: input.orderId,
        receiverId: input.customerId,
        originalNotificationId: input.notificationId,
        idempotencyKey: `order-placed-retry:${input.notificationId}`,
        data: parsed.data,
      },
    );
  } catch {
    return { success: false, error: "Order confirmation could not be sent." };
  }
}

export async function sendOrderClaimCreatedEmail(input: {
  email: string;
  orderId?: string;
  customerId?: string | null;
  claimId?: string;
  currencyCode: string;
  orderDisplayId: number;
  claimDisplayId: number;
  claimType: "refund" | "replace";
  requiresReturn: boolean;
  refundAmount: number | null;
  inboundItems: Array<{
    title: string;
    sku: string | null;
    quantity: number;
  }>;
  outboundItems: Array<{
    title: string;
    sku: string | null;
    quantity: number;
  }>;
  returnShipping: { name: string; amount: number } | null;
  outboundShipping: { name: string; amount: number } | null;
}): Promise<SendEmailResult> {
  try {
    const config = getConfig();
    const currencyCode = input.currencyCode.toUpperCase();
    const decimalDigits = findCurrency(input.currencyCode)?.decimalDigits ?? 2;
    const formatAmount = (amount: number) =>
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currencyCode,
        minimumFractionDigits: decimalDigits,
        maximumFractionDigits: decimalDigits,
      }).format(amount / 10 ** decimalDigits);
    const html = await render(
      OrderClaimCreatedEmail({
        appName: config.server.appName,
        orderDisplayId: input.orderDisplayId,
        claimDisplayId: input.claimDisplayId,
        claimType: input.claimType,
        requiresReturn: input.requiresReturn,
        refundAmount:
          input.refundAmount === null ? null : formatAmount(input.refundAmount),
        inboundItems: input.inboundItems,
        outboundItems: input.outboundItems,
        returnShipping: input.returnShipping
          ? {
              ...input.returnShipping,
              amount: formatAmount(input.returnShipping.amount),
            }
          : null,
        outboundShipping: input.outboundShipping
          ? {
              ...input.outboundShipping,
              amount: formatAmount(input.outboundShipping.amount),
            }
          : null,
      }),
    );
    return await sendCommerceNotificationEmail(
      {
        to: input.email,
        subject:
          input.claimType === "refund"
            ? `Refund claim #${input.claimDisplayId} recorded for order #${input.orderDisplayId}`
            : `Replacement claim #${input.claimDisplayId} confirmed for order #${input.orderDisplayId}`,
        html,
      },
      {
        template: "order-claim-created",
        triggerType: "order.claim.created",
        resourceType: "order",
        resourceId: input.orderId ?? null,
        receiverId: input.customerId,
        ...(input.claimId
          ? { idempotencyKey: `order-claim-created:${input.claimId}` }
          : {}),
      },
    );
  } catch {
    return {
      success: false,
      error: "Claim notification could not be sent.",
    };
  }
}

export async function sendOrderTransferRequestedEmail(input: {
  email: string;
  transferId?: string;
  customerId?: string | null;
  orderDisplayId: number;
  orderId: string;
  targetEmail: string;
  description: string | null;
  token: string;
  confirmationUrl: string | null;
}): Promise<SendEmailResult> {
  try {
    const config = getConfig();
    const html = await render(
      OrderTransferRequestedEmail({
        appName: config.server.appName,
        orderDisplayId: input.orderDisplayId,
        orderId: input.orderId,
        targetEmail: input.targetEmail,
        description: input.description,
        token: input.token,
        confirmationUrl: input.confirmationUrl,
      }),
    );
    return await sendCommerceNotificationEmail(
      {
        to: input.email,
        subject: `Confirm order #${input.orderDisplayId} for ${config.server.appName}`,
        html,
      },
      {
        template: "order-transfer-requested",
        triggerType: "order.transfer.requested",
        resourceType: "order",
        resourceId: input.orderId,
        receiverId: input.customerId,
        ...(input.transferId
          ? { idempotencyKey: `order-transfer-requested:${input.transferId}` }
          : {}),
      },
    );
  } catch {
    return {
      success: false,
      error: "Order transfer confirmation could not be sent.",
    };
  }
}
