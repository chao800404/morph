import { Buffer } from "node:buffer";
import { z } from "zod";
import type {
  EmailAdapter,
  EmailSenderConfig,
  SendEmailParams,
  SendEmailResult,
} from "../types";

export interface CloudflareAdapterConfig extends EmailSenderConfig {
  accountId: string;
  apiToken: string;
}

// REST uses address/reply_to, not the Workers binding's email/replyTo fields.
// https://developers.cloudflare.com/email-service/examples/email-sending/recipients/
const deliverySchema = z.object({
  success: z.literal(true),
  errors: z.array(z.unknown()).length(0),
  result: z.object({
    delivered: z.array(z.string()),
    queued: z.array(z.string()),
    permanent_bounces: z.array(z.string()),
    suppressed_recipients: z.array(z.string()).optional().default([]),
    message_id: z.string().min(1).optional(),
  }),
});

const addressSchema = z.email();
const MAX_RECIPIENTS = 50;
// Conservative JSON-body cap; Cloudflare also enforces its encoded-message cap.
const MAX_REQUEST_BYTES = 5 * 1024 * 1024;
const SEND_TIMEOUT_MS = 15_000;

function mailbox(value: string): { address: string; name?: string } {
  if (/[\r\n]/.test(value)) throw new Error("Invalid mailbox");
  const named = /^(.*?)\s*<([^<>]+)>$/.exec(value.trim());
  const address = named ? named[2].trim() : value.trim();
  if (!addressSchema.safeParse(address).success) {
    throw new Error("Invalid mailbox");
  }
  return { address, ...(named ? { name: named[1].trim() } : {}) };
}

/** Email Sending REST API. No routing-only binding, fallback, or automatic retry. */
export class CloudflareAdapter implements EmailAdapter {
  readonly id = "cloudflare";

  constructor(private readonly config: CloudflareAdapterConfig) {}

  private fail(code: string): SendEmailResult {
    // Neither upstream error text nor message/recipient/credential data is logged.
    console.error("Cloudflare email failed:", code);
    return { success: false, error: `Cloudflare email failed: ${code}` };
  }

  async send(params: SendEmailParams): Promise<SendEmailResult> {
    const accountId = this.config.accountId.trim();
    const apiToken = this.config.apiToken.trim();
    if (
      !/^[a-f0-9]{32}$/i.test(accountId) ||
      !apiToken ||
      /[\r\n]/.test(apiToken)
    ) {
      return this.fail("NOT_CONFIGURED");
    }

    let body: string;
    let recipients: Array<{ address: string; name?: string }>;
    try {
      recipients = (Array.isArray(params.to) ? params.to : [params.to]).map(
        mailbox,
      );
      if (recipients.length === 0 || recipients.length > MAX_RECIPIENTS) {
        return this.fail("RECIPIENT_LIMIT");
      }
      const from = params.from
        ? mailbox(params.from)
        : {
            ...mailbox(this.config.defaultFromAddress),
            ...(this.config.defaultFromName
              ? { name: this.config.defaultFromName }
              : {}),
          };
      if (from.name && /[\r\n]/.test(from.name))
        return this.fail("INVALID_MESSAGE");
      body = JSON.stringify({
        from,
        to: recipients,
        subject: params.subject,
        html: params.html,
        text: params.text,
        reply_to: params.replyTo ? mailbox(params.replyTo) : undefined,
        attachments: params.attachments?.map((attachment) => ({
          filename: attachment.filename,
          content:
            typeof attachment.content === "string"
              ? attachment.content
              : Buffer.from(attachment.content).toString("base64"),
          type: attachment.contentType ?? "application/octet-stream",
          disposition: "attachment",
        })),
      });
    } catch {
      return this.fail("INVALID_MESSAGE");
    }
    if (new TextEncoder().encode(body).byteLength > MAX_REQUEST_BYTES) {
      return this.fail("MESSAGE_TOO_LARGE");
    }

    try {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiToken}`,
            "Content-Type": "application/json",
          },
          body,
          redirect: "error",
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        },
      );
      if (!response.ok) return this.fail("PROVIDER_REJECTED");
      const parsed = deliverySchema.safeParse(await response.json());
      if (!parsed.success) return this.fail("INVALID_RESPONSE");
      const result = parsed.data.result;
      // HTTP 200 / success:true can still contain bounces or dropped recipients.
      const accepted = new Set([...result.delivered, ...result.queued]);
      if (
        result.permanent_bounces.length > 0 ||
        result.suppressed_recipients.length > 0 ||
        !recipients.every(({ address }) => accepted.has(address))
      ) {
        return this.fail("RECIPIENT_NOT_ACCEPTED");
      }
      return {
        success: true,
        ...(result.message_id ? { messageId: result.message_id } : {}),
      };
    } catch {
      // An unknown send outcome must never trigger an automatic resend.
      return this.fail("REQUEST_FAILED");
    }
  }

  async sendBatch(params: SendEmailParams[]): Promise<SendEmailResult[]> {
    const results: SendEmailResult[] = [];
    for (const message of params) results.push(await this.send(message));
    return results;
  }
}
