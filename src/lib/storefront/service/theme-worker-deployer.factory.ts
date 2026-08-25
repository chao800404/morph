import { env } from "cloudflare:workers";
import { SandboxWranglerThemeWorkerDeployer } from "./sandbox-wrangler-theme-worker-deployer";
import { isProductionEnvironment } from "./storefront-domain-provider";
import {
  OperatorManagedThemeWorkerDeployer,
  UnavailableThemeWorkerDeployer,
  type ThemeWorkerDeployer,
} from "./theme-worker-deployer.types";

/**
 * Server composition root for Theme Worker deployment.
 *
 * Deployment is only available when every requirement is present: a Sandbox
 * container to run the pinned wrangler in, the R2 bucket holding the immutable
 * artifact, and the Cloudflare credentials for the target account. A missing
 * piece yields an explicitly unavailable deployer rather than a partially
 * wired one, so a release can never be reported as deployed when it was not.
 */
export function createServerThemeWorkerDeployer(): ThemeWorkerDeployer {
  const bindings = env as unknown as Record<string, unknown>;

  const sandboxBinding = bindings.Sandbox;
  const r2Bucket = bindings.R2_BUCKET;
  const apiToken =
    typeof bindings.CLOUDFLARE_API_TOKEN === "string"
      ? bindings.CLOUDFLARE_API_TOKEN
      : undefined;
  const accountId =
    typeof bindings.CLOUDFLARE_ACCOUNT_ID === "string"
      ? bindings.CLOUDFLARE_ACCOUNT_ID
      : undefined;

  // Local development forwards to an operator-started Theme Worker instead of
  // deploying one, so activation has nothing to upload. Never in production,
  // where activation must mean the artifact was really uploaded — and never
  // when real credentials are present, so a configured environment cannot
  // silently skip deployment.
  const localThemeOrigin =
    typeof bindings.MORPH_LOCAL_THEME_ORIGIN === "string" &&
    bindings.MORPH_LOCAL_THEME_ORIGIN.trim() !== "";
  if (
    localThemeOrigin &&
    !apiToken &&
    !accountId &&
    !isProductionEnvironment(bindings)
  ) {
    return new OperatorManagedThemeWorkerDeployer();
  }

  const missing: string[] = [];
  if (!sandboxBinding) missing.push("Sandbox container binding");
  if (!r2Bucket) missing.push("R2_BUCKET binding");
  if (!apiToken) missing.push("CLOUDFLARE_API_TOKEN");
  if (!accountId) missing.push("CLOUDFLARE_ACCOUNT_ID");

  if (missing.length > 0) {
    return new UnavailableThemeWorkerDeployer(
      `Theme Worker deployment is not configured. Missing: ${missing.join(", ")}.`,
    );
  }

  return new SandboxWranglerThemeWorkerDeployer({
    sandboxBinding,
    r2Bucket: r2Bucket as never,
    credentials: { apiToken, accountId },
  });
}
