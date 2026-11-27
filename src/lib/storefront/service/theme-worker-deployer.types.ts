import type { ThemeWorkerDeploymentPlan } from "./theme-worker-deployment-plan";

export type ThemeWorkerDeploymentRequest = Readonly<{
  plan: ThemeWorkerDeploymentPlan;
  /** Immutable R2 prefix the artifact bytes are read from. */
  artifactPrefix: string;
  storefrontId: string;
  releaseId: string;
  themeBuildId: string;
}>;

export type ThemeWorkerDeploymentFailureReason =
  | "DEPLOYER_NOT_CONFIGURED"
  | "CREDENTIALS_MISSING"
  | "ARTIFACT_UNREADABLE"
  | "UPLOAD_REJECTED"
  | "DEPLOY_TIMEOUT"
  | "DEPLOY_ERROR";

export type ThemeWorkerDeploymentResult =
  | {
      success: true;
      scriptName: string;
      /** Provider-side identity of what was deployed, when available. */
      deploymentId: string | null;
      durationMs: number;
    }
  | {
      success: false;
      reason: ThemeWorkerDeploymentFailureReason;
      message: string;
      /** Never include credentials or raw provider responses here. */
      diagnostics?: readonly string[];
    };

/**
 * Uploads one immutable build artifact as the storefront's Theme Worker.
 *
 * A deployer only ever transports bytes that a build produced and a plan
 * approved. It must not read the theme workspace, choose which release is live,
 * or mutate release state — activation remains a D1 decision that deployment
 * reconciles towards.
 *
 * Implementations must never write credentials into logs, diagnostics or the
 * returned result.
 */
export interface ThemeWorkerDeployer {
  readonly kind:
    | "sandbox-wrangler"
    | "cloudflare-api"
    | "operator-managed"
    | "unavailable";
  deploy(
    request: ThemeWorkerDeploymentRequest,
  ): Promise<ThemeWorkerDeploymentResult>;
}

/**
 * Explicit fail-closed deployer for environments with no deployment transport.
 *
 * Reporting an unavailable deployment is required: silently succeeding would
 * let a release be marked active while production still serves older bytes.
 */
export class UnavailableThemeWorkerDeployer implements ThemeWorkerDeployer {
  readonly kind = "unavailable" as const;

  constructor(private readonly detail?: string) {}

  async deploy(): Promise<ThemeWorkerDeploymentResult> {
    return {
      success: false,
      reason: "DEPLOYER_NOT_CONFIGURED",
      message:
        this.detail ??
        "No Theme Worker deployer is configured for this environment.",
    };
  }
}

/**
 * Local development deployer for an operator-managed Theme Worker.
 *
 * When `MORPH_LOCAL_THEME_ORIGIN` is used, the Theme Worker is started by hand
 * (see `scripts/theme-artifact-smoke.mjs`) and requests are forwarded to it
 * directly, so activation has nothing to upload. Reporting success is accurate
 * here — it is not a stubbed deployment, it is a topology where deployment is
 * the operator's step.
 *
 * It must never be selected in production, where a successful activation has to
 * mean the artifact was actually uploaded.
 */
export class OperatorManagedThemeWorkerDeployer implements ThemeWorkerDeployer {
  readonly kind = "operator-managed" as const;

  async deploy(
    request: ThemeWorkerDeploymentRequest,
  ): Promise<ThemeWorkerDeploymentResult> {
    return {
      success: true,
      scriptName: request.plan.scriptName,
      deploymentId: null,
      durationMs: 0,
    };
  }
}
