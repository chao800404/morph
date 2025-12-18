import { Resend } from "resend";
import type { EmailAdapter, SendEmailParams, SendEmailResult } from "../types";

export interface ResendAdapterConfig {
  apiKey: string;
  defaultFromAddress: string;
  defaultFromName?: string;
}

export class ResendAdapter implements EmailAdapter {
  private client: Resend | null = null;
  private defaultFrom: string;
  private isConfigured: boolean = false;

  constructor(config: ResendAdapterConfig) {
    // 驗證 API key
    if (!config.apiKey || config.apiKey.trim() === "") {
      console.warn(
        "⚠️  Resend API key is not configured. Email functionality will not work. " +
          "Please set RESEND_API_KEY in your environment variables.",
      );
      this.isConfigured = false;
    } else {
      // 延遲初始化 Resend client，確保在 Cloudflare Workers 環境中正常運作
      try {
        this.client = new Resend(config.apiKey);
        this.isConfigured = true;
      } catch (error) {
        console.error("❌ Failed to initialize Resend client:", error);
        this.isConfigured = false;
      }
    }

    // 組合 from address: "Name <email@domain.com>"
    this.defaultFrom = config.defaultFromName
      ? `${config.defaultFromName} <${config.defaultFromAddress}>`
      : config.defaultFromAddress;
  }

  async send(params: SendEmailParams): Promise<SendEmailResult> {
    // 檢查是否已配置
    if (!this.isConfigured || !this.client) {
      const errorMsg =
        "Email service is not configured. Please set RESEND_API_KEY in your environment variables.";
      console.error("❌", errorMsg);
      return {
        success: false,
        error: errorMsg,
      };
    }

    try {
      const { data, error } = await this.client.emails.send({
        from: params.from || this.defaultFrom,
        to: Array.isArray(params.to) ? params.to : [params.to],
        subject: params.subject,
        html: params.html,
        text: params.text,
        replyTo: params.replyTo,
        attachments: params.attachments?.map((att) => ({
          filename: att.filename,
          content: att.content,
        })),
      });

      if (error) {
        console.error("❌ Resend email error:", error);
        return {
          success: false,
          error: error.message,
        };
      }

      console.log("✅ Email sent successfully:", data?.id);
      return {
        success: true,
        messageId: data?.id,
      };
    } catch (error) {
      console.error("❌ Resend email exception:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async sendBatch(params: SendEmailParams[]): Promise<SendEmailResult[]> {
    // 檢查是否已配置
    if (!this.isConfigured || !this.client) {
      const errorMsg = "Email service is not configured.";
      console.error("❌", errorMsg);
      return params.map(() => ({
        success: false,
        error: errorMsg,
      }));
    }

    // Resend 支援 batch sending
    const results = await Promise.all(params.map((p) => this.send(p)));
    return results;
  }
}
