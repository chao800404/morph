import { svgIsolationHeadersFile } from "../theme-svg-isolation";
import { SANDBOX_PLATFORM_WRANGLER_BIN } from "../theme-framework/theme-toolchains";
import type { R2BucketLike } from "../compiler/cloudflare-r2-theme-build-artifact-store";
import { writeSandboxWorkspaceFile } from "@/lib/storefront/compiler/sandbox-file-writer";
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
/**
 * Where wrangler runs. The platform creates it, empty, in a container made for
 * this one deployment; artifacts are written only under `SERVER_DIR` and
 * `CLIENT_DIR`, by paths that are relative and never contain `..`, so nothing
 * a build produced can be placed here.
 */
const WORKING_DIR = `${DEPLOY_ROOT}/run`;
// The platform's Wrangler (sandbox/platform), never a Theme toolchain's: a
// deployment's tool does not change with the Theme's framework.
const WRANGLER_BIN = SANDBOX_PLATFORM_WRANGLER_BIN;
const DEFAULT_MAX_DURATION_MS = 180_000;

/** The Cloudflare API every Theme Worker is deployed through. */
export const CLOUDFLARE_API_BASE_URL = "https://api.cloudflare.com/client/v4";

/**
 * How wrangler is run for a deployment: command, working directory and
 * environment. Shared with the test that runs the real wrangler against it.
 *
 * The credential is sent only where the platform says. wrangler reads its own
 * settings — among them the API address, the API environment, a proxy, and a
 * global API key that it prefers to the token — from the environment, and adds
 * to the environment whatever `.env` and `.env.local` in its working directory
 * hold. Three things keep those files from deciding where the token goes:
 *
 * - wrangler runs in `WORKING_DIR`, which no artifact can write into;
 * - `--env-file` names an empty file, so no `.env` is loaded from anywhere;
 * - the destination settings wrangler reads are set here to the official
 *   values. A variable already set is not replaced by a `.env` value, but only
 *   when it is non-empty, which is why this is the last layer rather than the
 *   first: a proxy or a global key cannot be pinned to an empty value.
 *
 * `apiBaseUrl` exists for that test and is never passed by the deployer; no
 * binding or variable can move a deployment to another API.
 */
export function wranglerDeployInvocation(args: {
  apiToken: string;
  accountId: string;
  wranglerBin?: string;
  configPath?: string;
  workingDir?: string;
  apiBaseUrl?: string;
}): Readonly<{
  argv: readonly string[];
  command: string;
  cwd: string;
  env: Readonly<Record<string, string>>;
}> {
  const argv = [
    args.wranglerBin ?? WRANGLER_BIN,
    "deploy",
    "--config",
    args.configPath ?? `${SERVER_DIR}/wrangler.json`,
    "--env-file",
    "/dev/null",
  ];
  return {
    argv,
    command: argv.join(" "),
    cwd: args.workingDir ?? WORKING_DIR,
    env: {
      CLOUDFLARE_API_TOKEN: args.apiToken,
      CLOUDFLARE_ACCOUNT_ID: args.accountId,
      CLOUDFLARE_API_BASE_URL: args.apiBaseUrl ?? CLOUDFLARE_API_BASE_URL,
      WRANGLER_API_ENVIRONMENT: "production",
      CLOUDFLARE_COMPLIANCE_REGION: "public",
      WRANGLER_SEND_METRICS: "false",
      CI: "true",
    },
  };
}

/** The wrangler configuration for a deployment plan; paths are relative to it. */
export function wranglerDeployConfig(
  plan: ThemeWorkerDeploymentRequest["plan"],
): Record<string, unknown> {
  // `no_bundle` keeps the built chunks intact, but then the entry only
  // imports them by path — without module `rules` workerd cannot resolve
  // them and the deployment fails with "No such module".
  return {
    name: plan.scriptName,
    main: plan.mainModule,
    compatibility_date: plan.compatibilityDate,
    compatibility_flags: [...plan.compatibilityFlags],
    assets: { directory: "../client" },
    no_bundle: true,
    rules: [{ type: "ESModule", globs: ["**/*.js", "**/*.mjs"] }],
    // No public address of its own. Morph Core reaches the Theme Worker
    // through a service binding only, after resolving the storefront's
    // host, release and content; a `*.workers.dev` URL or a version's
    // preview URL would serve the same Worker around all of that.
    // Written out because Wrangler defaults `workers_dev` to true, and
    // turning it off does not by itself turn preview URLs off.
    workers_dev: false,
    preview_urls: false,
  };
}

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
        // Bytes, so base64: the SDK takes strings, and a Uint8Array handed to
        // it is serialised as an object of numbered keys, not as the file.
        await writeSandboxWorkspaceFile(
          sandbox,
          `${SERVER_DIR}/${module.modulePath}`,
          bytes,
        );
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
        await writeSandboxWorkspaceFile(
          sandbox,
          `${CLIENT_DIR}${asset.servedPath}`,
          bytes,
        );
      }

      // Static assets can be answered before the Worker runs, so headers the
      // Worker sets never reach them; the platform's `_headers` does.
      await sandbox.writeFile(
        `${CLIENT_DIR}/_headers`,
        svgIsolationHeadersFile(),
      );

      await sandbox.writeFile(
        `${SERVER_DIR}/wrangler.json`,
        JSON.stringify(wranglerDeployConfig(request.plan), null, 2),
      );
      await sandbox.mkdir(WORKING_DIR, { recursive: true });

      const maxDurationMs =
        this.options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
      const invocation = wranglerDeployInvocation({ apiToken, accountId });
      const execResult = await sandbox.exec(invocation.command, {
        timeout: maxDurationMs,
        timeoutMs: maxDurationMs,
        cwd: invocation.cwd,
        // The credential exists only in this exec environment. It is never
        // written into the workspace, where build output could capture it.
        env: { ...invocation.env },
      });

      const stdout = scrub(execResult.stdout ?? "");
      const stderr = scrub(execResult.stderr ?? "");
      const succeeded = execResult.success ?? execResult.exitCode === 0;

      if (!succeeded) {
        const detail = stderr || stdout || "wrangler deploy exited non-zero";
        return {
          success: false,
          reason: /timed? ?out/i.test(detail)
            ? "DEPLOY_TIMEOUT"
            : "UPLOAD_REJECTED",
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
        reason: /timed? ?out/i.test(message)
          ? "DEPLOY_TIMEOUT"
          : "DEPLOY_ERROR",
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
