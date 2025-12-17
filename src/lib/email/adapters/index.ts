


export { ResendAdapter, type ResendAdapterConfig } from "./resend.adapter";

// 未來可以新增其他 adapters
// export { AwsSesAdapter } from './aws-ses.adapter';
// export { BrevoAdapter } from './brevo.adapter';
// export { SendGridAdapter } from './sendgrid.adapter';

// Helper functions to create adapters (PayloadCMS style)
import type { EmailAdapter } from "../types";
import { ResendAdapter, type ResendAdapterConfig } from "./resend.adapter";

/**
 * 創建 Resend adapter
 * @example
 * ```ts
 * email: resendAdapter({
 *   apiKey: process.env.RESEND_API_KEY || '',
 *   defaultFromAddress: 'noreply@yourdomain.com',
 *   defaultFromName: 'Your Company',
 * })
 * ```
 */
export function resendAdapter(config: ResendAdapterConfig): EmailAdapter {
    return new ResendAdapter(config);
}

// 未來的 adapter helper functions
// export function awsSesAdapter(config: AwsSesAdapterConfig): EmailAdapter { ... }
// export function brevoAdapter(config: BrevoAdapterConfig): EmailAdapter { ... }
// export function sendgridAdapter(config: SendGridAdapterConfig): EmailAdapter { ... }
