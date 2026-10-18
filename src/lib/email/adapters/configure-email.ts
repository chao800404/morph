import type {
  EmailAdapter,
  EmailProviderConfig,
  EmailSenderConfig,
} from "../types";
import { CloudflareAdapter } from "./cloudflare.adapter";
import { ResendAdapter } from "./resend.adapter";

/** Composition root only: an explicit provider never falls back to another one. */
export function configureEmail(
  defaults: EmailSenderConfig,
  settings: EmailProviderConfig = {},
) {
  const sender: EmailSenderConfig = {
    defaultFromAddress:
      settings.defaultFromAddress ?? defaults.defaultFromAddress,
    defaultFromName: settings.defaultFromName ?? defaults.defaultFromName,
    supportAddress: settings.supportAddress ?? defaults.supportAddress,
  };
  let email: EmailAdapter;
  const provider = settings.provider ?? "resend";
  if (provider === "resend") {
    email = new ResendAdapter({ ...sender, apiKey: settings.apiKey ?? "" });
  } else if (provider === "cloudflare") {
    email = new CloudflareAdapter({
      ...sender,
      accountId: settings.cloudflare?.accountId ?? "",
      apiToken: settings.cloudflare?.apiToken ?? "",
    });
  } else {
    // Do not fail the whole CMS startup, but never silently choose Resend.
    email = {
      id: "unconfigured",
      async send() {
        console.error("Email service failed: INVALID_PROVIDER");
        return {
          success: false,
          error: "Email service failed: INVALID_PROVIDER",
        };
      },
    };
  }
  return { email, emailSupportAddress: sender.supportAddress };
}
