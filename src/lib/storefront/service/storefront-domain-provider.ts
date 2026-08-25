/**
 * Transport used to attach a hostname to the storefront Worker.
 *
 * Production attaches a real Cloudflare Workers Custom Domain. Local
 * development has no such object to create — a hostname simply has to resolve
 * to the dev server — so a bounded local provider stands in for it.
 */
export interface StorefrontDomainProvider {
  readonly kind: "cloudflare" | "local";
  attach(hostname: string): Promise<string | null>;
  detach(domainId: string): Promise<void>;
}

export type DomainProviderEnvironment = Record<string, unknown> | undefined;

/**
 * Detects a production runtime using the same signals as the rest of the app.
 *
 * Local domain provisioning must be impossible here: it would activate a
 * hostname without Cloudflare ever routing it, producing a domain that reports
 * as connected while every request to it fails.
 */
export function isProductionEnvironment(env: DomainProviderEnvironment): boolean {
  const candidate = env as
    | { CF_PAGES?: string; ENVIRONMENT?: string }
    | undefined;
  return (
    candidate?.CF_PAGES === "1" ||
    candidate?.ENVIRONMENT === "production" ||
    process.env.NODE_ENV === "production"
  );
}

/**
 * Local stand-in for Cloudflare domain attachment.
 *
 * It performs no network call and returns a clearly synthetic id so a local
 * record can never be mistaken for a real Cloudflare Custom Domain. Detach is a
 * no-op because nothing was ever created.
 */
export class LocalStorefrontDomainProvider implements StorefrontDomainProvider {
  readonly kind = "local" as const;

  async attach(hostname: string): Promise<string | null> {
    return `local-dev:${hostname}`;
  }

  async detach(): Promise<void> {
    // Nothing was provisioned remotely, so there is nothing to release.
  }
}

export const LOCAL_DOMAIN_PROVISIONING_FLAG =
  "MORPH_ALLOW_LOCAL_DOMAIN_PROVISIONING";

export type DomainProviderSelection =
  | { available: true; provider: StorefrontDomainProvider }
  | { available: false; reason: string };

/**
 * Chooses the domain provider for the current environment.
 *
 * Cloudflare is used whenever its credentials are configured, so a configured
 * environment can never silently fall back to the local stand-in. The local
 * provider requires an explicit opt-in flag **and** a non-production runtime;
 * failing closed is preferred over activating a hostname nothing routes.
 */
export function selectStorefrontDomainProvider(args: {
  env: DomainProviderEnvironment;
  cloudflareProvider: StorefrontDomainProvider;
}): DomainProviderSelection {
  const env = args.env;
  const hasCloudflareCredentials =
    typeof env?.CLOUDFLARE_API_TOKEN === "string" &&
    (env.CLOUDFLARE_API_TOKEN as string).trim() !== "" &&
    typeof env?.CLOUDFLARE_ACCOUNT_ID === "string" &&
    (env.CLOUDFLARE_ACCOUNT_ID as string).trim() !== "" &&
    typeof env?.CLOUDFLARE_ZONE_ID === "string" &&
    (env.CLOUDFLARE_ZONE_ID as string).trim() !== "" &&
    typeof env?.CLOUDFLARE_WORKER_SERVICE === "string" &&
    (env.CLOUDFLARE_WORKER_SERVICE as string).trim() !== "";

  if (hasCloudflareCredentials) {
    return { available: true, provider: args.cloudflareProvider };
  }

  const optedIn = env?.[LOCAL_DOMAIN_PROVISIONING_FLAG] === "true";
  if (!optedIn) {
    return {
      available: false,
      reason:
        "Cloudflare domain management is not configured. Set the Cloudflare credentials, or set " +
        `${LOCAL_DOMAIN_PROVISIONING_FLAG}=true in .dev.vars for local development.`,
    };
  }

  if (isProductionEnvironment(env)) {
    return {
      available: false,
      reason:
        `${LOCAL_DOMAIN_PROVISIONING_FLAG} cannot be used in production: a locally activated hostname would not be routed by Cloudflare.`,
    };
  }

  return { available: true, provider: new LocalStorefrontDomainProvider() };
}
