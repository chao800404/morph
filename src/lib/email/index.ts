import { getConfig } from "@/server/get-config";
import type { EmailAdapter, SendEmailParams, SendEmailResult } from "./types";
import AuthOtpEmail from "./templates/auth-otp";

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
