import type { JsonValue, Metadata } from "@/db/json";
import { notificationDal } from "../dal/notification.dal";
import type { SendEmailParams, SendEmailResult } from "@/lib/email/types";

interface EmailNotificationAdapter {
  send(params: SendEmailParams): Promise<SendEmailResult>;
}

export interface EmailNotificationRecord {
  template: string;
  triggerType: string;
  resourceType: string;
  resourceId: string | null;
  receiverId?: string | null;
  originalNotificationId?: string | null;
  idempotencyKey?: string;
  data?: Metadata | null;
  adapterId?: string;
}

const providerDataFor = (adapterId: string | undefined): JsonValue | null =>
  adapterId ? { adapterId } : null;

/**
 * Record an email attempt before sending, then persist the provider result.
 * Stable idempotency keys make retried commerce workflows return the first
 * result instead of sending the same customer email twice.
 */
export async function sendEmailNotification(input: {
  adapter: EmailNotificationAdapter;
  params: SendEmailParams & { to: string };
  record: EmailNotificationRecord;
}): Promise<SendEmailResult> {
  const notificationId = crypto.randomUUID();
  const now = new Date().toISOString();
  const attempt = await notificationDal.createAttempt({
    id: notificationId,
    to: input.params.to,
    from: input.params.from ?? null,
    channel: "email",
    template: input.record.template,
    triggerType: input.record.triggerType,
    resourceType: input.record.resourceType,
    resourceId: input.record.resourceId,
    receiverId: input.record.receiverId ?? null,
    originalNotificationId: input.record.originalNotificationId ?? null,
    idempotencyKey: input.record.idempotencyKey ?? null,
    data: input.record.data ?? null,
    providerData: providerDataFor(input.record.adapterId),
    now,
  });

  if (!attempt.created) {
    return attempt.notification.status === "success"
      ? {
          success: true,
          ...(attempt.notification.externalId
            ? { messageId: attempt.notification.externalId }
            : {}),
        }
      : { success: false, error: "Notification was already attempted" };
  }

  let result: SendEmailResult;
  try {
    result = await input.adapter.send(input.params);
  } catch {
    try {
      await notificationDal.finishAttempt(notificationId, {
        status: "failure",
        externalId: null,
      });
    } catch {
      // A provider failure still needs to reach the caller if D1 is unavailable.
    }
    return { success: false, error: "Notification provider failed" };
  }

  try {
    await notificationDal.finishAttempt(notificationId, {
      status: result.success ? "success" : "failure",
      externalId: result.success ? (result.messageId ?? null) : null,
    });
  } catch {
    // Sending has already happened; do not make a successful email look failed
    // to a caller that may compensate an unrelated commerce operation.
  }

  return result.success
    ? result
    : { success: false, error: "Notification provider failed" };
}
