import type { R2BucketLike } from "../compiler/cloudflare-r2-theme-build-artifact-store";
import type {
  CloudflareSandboxProvider,
  CloudflareSandboxSession,
} from "../compiler/cloudflare-sandbox-vite-theme-build-runner";
import type {
  ThemeWorkerDeployer,
  ThemeWorkerDeploymentRequest,
  ThemeWorkerDeploymentResult,
} from "./theme-worker-deployer.types";

const DEPLOY_ROOT = "/workspace/deploy";
const SERVER_DIR = `${DEPLOY_ROOT}/server`;
const CLIENT_DIR = `${DEPLOY_ROOT}/client`;
const WRANGLER_BIN = "/opt/morph-toolchain/node_modules/.bin/wrangler";
const DEFAULT_MAX_DURATION_MS = 180_000;

export type ThemeDeploymentCredentials = Readonly<{
  apiToken?: string;
  accountId?: string;
}>;

export type SandboxWranglerDeployerOptions = Readonly<{
  sandboxBinding?: unknown;
  sandboxProvider?: CloudflareSandboxProvider;
  r2Bucket?: R2BucketLike;
  credentials?: ThemeDeploymentCredentials;
  maxDurationMs?: number;
}>;

/**
 * Removes credential material from anything that may be surfaced or logged.
 *
 * wrangler echoes its own argv and environment in some failure modes, so output
 * is scrubbed before it can reach diagnostics, logs or a UI.
 */
export function scrubDeploymentSecrets(
  text: string,
  secrets: ReadonlyArray<string | undefined>,
): string {
  let scrubbed = text;
  for (const secret of secrets) {
    if (!secret || secret.length < 8) continue;
    scrubbed = scrubbed.split(secret).join("[redacted]");
  }
  return scrubbed;
}

/**
 * Session id for a deployment container.
 *
 * Deployments must never share a session with a build. A build session executes
 * customer theme code, and the client's Cloudflare API token is present during
 * deployment — putting both in one container would expose the credential to
 * code the platform does not control.
 */
export function deploymentSandboxSessionId(
  storefrontId: string,
  releaseId: string,
): string {
  return `deploy-${storefrontId}-${releaseId}`;
}

async function readArtifactBytes(
  r2Bucket: R2BucketLike,
  key: string,
): Promise<Uint8Array | null> {
  const object = await r2Bucket.get(key);
  if (!object) return null;
  const candidate = object as {
    arrayBuffer?: () => Promise<ArrayBuffer>;
    body?: unknown;
  };
  if (typeof candidate.arrayBuffer === "function") {
    return new Uint8Array(await candidate.arrayBuffer());
  }
  return null;
}

/**
 * Deploys a Theme Worker by running the pinned wrangler inside an isolated
 * Cloudflare Sandbox container.
 *
 * wrangler owns the upload protocol — asset hashing, upload sessions, bucketed
 * uploads and the modules multipart request — so the platform does not
 * reimplement a surface that Cloudflare versions independently.
 *
 * Only bytes named by an approved deployment plan are materialized, so a
 * deployment can never carry a file the plan rejected.
 */
export class SandboxWranglerThemeWorkerDeployer implements ThemeWorkerDeployer {
  readonly kind = "sandbox-wrangler" as const;

  constructor(private readonly options: SandboxWranglerDeployerOptions) {}

  async deploy(
    request: ThemeWorkerDeploymentRequest,
  ): Promise<ThemeWorkerDeploymentResult> {
    const startedAt = Date.now();
    const apiToken = this.options.credentials?.apiToken;
    const accountId = this.options.credentials?.accountId;

    if (!apiToken || !accountId) {
      return {
        success: false,
        reason: "CREDENTIALS_MISSING",
        message:
          "Cloudflare deployment credentials are not configured. Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID as Worker secrets.",
      };
    }

    const r2Bucket = this.options.r2Bucket;
    if (!r2Bucket) {
      return {
        success: false,
        reason: "ARTIFACT_UNREADABLE",
        message: "R2 storage bucket binding is not configured.",
      };
    }

    let sandbox: CloudflareSandboxSession | null = null;
    const scrub = (text: string) =>
      scrubDeploymentSecrets(text, [apiToken, accountId]);

    try {
      const sessionId = deploymentSandboxSessionId(
        request.storefrontId,
        request.releaseId,
      );

      if (this.options.sandboxProvider) {
        sandbox = await this.options.sandboxProvider.getSandbox(
          this.options.sandboxBinding,
          sessionId,
        );
      } else if (this.options.sandboxBinding) {
        const { getSandbox } = await import("@cloudflare/sandbox");
        sandbox = getSandbox(
          this.options.sandboxBinding as never,
          sessionId,
        ) as unknown as CloudflareSandboxSession;
      } else {
        return {
          success: false,
          reason: "DEPLOYER_NOT_CONFIGURED",
          message:
            "Cloudflare Sandbox binding or provider is not configured for deployment.",
        };
      }

      await sandbox.mkdir(SERVER_DIR, { recursive: true });
      await sandbox.mkdir(CLIENT_DIR, { recursive: true });

      for (const module of request.plan.modules) {
        const bytes = await readArtifactBytes(
          r2Bucket,
          `${request.artifactPrefix}/${module.artifactPath}`,
        );
        if (!bytes) {
          return {
            success: false,
            reason: "ARTIFACT_UNREADABLE",
            message: `Worker module "${module.modulePath}" is missing from the immutable artifact.`,
          };
        }
        await sandbox.writeFile(`${SERVER_DIR}/${module.modulePath}`, bytes);
      }

      for (const asset of request.plan.assets) {
        const bytes = await readArtifactBytes(
          r2Bucket,
          `${request.artifactPrefix}/${asset.artifactPath}`,
        );
        if (!bytes) {
          return {
            success: false,
            reason: "ARTIFACT_UNREADABLE",
            message: `Client asset "${asset.servedPath}" is missing from the immutable artifact.`,
          };
        }
        await sandbox.writeFile(`${CLIENT_DIR}${asset.servedPath}`, bytes);
      }

      // `no_bundle` keeps the built chunks intact, but then the entry only
      // imports them by path — without module `rules` workerd cannot resolve
      // them and the deployment fails with "No such module".
      const wranglerConfig = {
        name: request.plan.scriptName,
        main: request.plan.mainModule,
        compatibility_date: request.plan.compatibilityDate,
        compatibility_flags: [...request.plan.compatibilityFlags],
        assets: { directory: "../client" },
        no_bundle: true,
        rules: [{ type: "ESModule", globs: ["**/*.js", "**/*.mjs"] }],
      };
      await sandbox.writeFile(
        `${SERVER_DIR}/wrangler.json`,
        JSON.stringify(wranglerConfig, null, 2),
      );

      const maxDurationMs = this.options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
      const execResult = await sandbox.exec(
        `${WRANGLER_BIN} deploy -c ${SERVER_DIR}/wrangler.json`,
        {
          timeout: maxDurationMs,
          timeoutMs: maxDurationMs,
          // The credential exists only in this exec environment. It is never
          // written into the workspace, where build output could capture it.
          env: {
            CLOUDFLARE_API_TOKEN: apiToken,
            CLOUDFLARE_ACCOUNT_ID: accountId,
            WRANGLER_SEND_METRICS: "false",
            CI: "true",
          },
        },
      );

      const stdout = scrub(execResult.stdout ?? "");
      const stderr = scrub(execResult.stderr ?? "");
      const succeeded = execResult.success ?? execResult.exitCode === 0;

      if (!succeeded) {
        const detail = stderr || stdout || "wrangler deploy exited non-zero";
        return {
          success: false,
          reason: /timed? ?out/i.test(detail) ? "DEPLOY_TIMEOUT" : "UPLOAD_REJECTED",
          message: `Theme Worker deployment failed: ${detail.slice(0, 500)}`,
          diagnostics: [detail.slice(0, 2000)],
        };
      }

      const versionMatch = stdout.match(
        /Current Version ID:\s*([0-9a-f-]{8,})/i,
      );

      return {
        success: true,
        scriptName: request.plan.scriptName,
        deploymentId: versionMatch?.[1] ?? null,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      const message = scrub(
        error instanceof Error ? error.message : String(error),
      );
      return {
        success: false,
        reason: /timed? ?out/i.test(message) ? "DEPLOY_TIMEOUT" : "DEPLOY_ERROR",
        message: `Theme Worker deployment error: ${message.slice(0, 500)}`,
      };
    } finally {
      // The container held a credential in its process environment; never leave
      // it running after the deployment completes.
      try {
        await sandbox?.destroy();
      } catch {}
    }
  }
}
