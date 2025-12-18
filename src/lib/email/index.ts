import { getConfig } from "@/cms.config";
import type { EmailAdapter, SendEmailParams, SendEmailResult } from "./types";

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

  await sendEmail({
    to: email,
    subject: `Reset your password for ${config.server.appName}`,
    html: emailHtml,
  });
}
