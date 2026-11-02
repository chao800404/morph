import type {
  ReleaseActivationFailureReason,
  ReleaseDeploymentFailureDetail,
} from "./storefront-release-reconciler";

/**
 * The stable reason a publish's deployment failed, and a sentence for the
 * author.
 *
 * The most specific code wins: the plan rule or deployer reason when there is
 * one, then the reconciler's own reason. `DEPLOY_ERROR` covers a deployer
 * that threw instead of reporting.
 */
export type ReleaseDeploymentFailureCode =
  | ReleaseDeploymentFailureDetail
  | Exclude<
      ReleaseActivationFailureReason,
      "PLAN_REJECTED" | "DEPLOY_FAILED" | "ACTIVATION_CONFLICT"
    >;

const EXPLANATIONS: Record<ReleaseDeploymentFailureCode, string> = {
  MISSING_WORKER_ENTRY:
    "the build has no Worker entry the storefront could run",
  MISSING_CLIENT_ASSETS: "the build wrote no client output",
  INVALID_WORKER_CONFIG: "the build's Worker config is missing or incomplete",
  FORBIDDEN_BINDING:
    "the build's Worker config asks for a binding the platform does not provide",
  INVALID_SCRIPT_NAME: "this storefront's id cannot name a Theme Worker",
  RELEASE_NOT_FOUND: "the release was not found",
  BUILD_NOT_DEPLOYABLE: "the release has no succeeded build to deploy",
  WORKER_CONFIG_UNREADABLE: "the build's Worker config could not be read",
  DEPLOYER_NOT_CONFIGURED:
    "Theme Worker deployment is not configured in this environment",
  CREDENTIALS_MISSING: "Cloudflare deployment credentials are not configured",
  ARTIFACT_UNREADABLE: "a file of the build could not be read",
  UPLOAD_REJECTED: "Cloudflare rejected the upload",
  DEPLOY_TIMEOUT: "the deployment timed out",
  DEPLOY_ERROR: "the deployment failed unexpectedly",
};

/** Codes that a retry cannot fix: the build itself has to change. */
const BUILD_SHAPE_CODES = new Set<ReleaseDeploymentFailureCode>([
  "MISSING_WORKER_ENTRY",
  "MISSING_CLIENT_ASSETS",
  "INVALID_WORKER_CONFIG",
  "FORBIDDEN_BINDING",
]);

function isCode(value: unknown): value is ReleaseDeploymentFailureCode {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(EXPLANATIONS, value)
  );
}

export function releaseDeploymentFailureCode(outcome: {
  reason?: unknown;
  detail?: unknown;
}): ReleaseDeploymentFailureCode {
  if (isCode(outcome.detail)) return outcome.detail;
  if (isCode(outcome.reason)) return outcome.reason;
  return "DEPLOY_ERROR";
}

/**
 * What a failed publish deployment tells the author. The previous activation
 * is restored either way, unless `deploymentDrift` says it could not be.
 */
export function describeReleaseDeploymentFailure(outcome: {
  reason?: unknown;
  detail?: unknown;
  deploymentDrift?: boolean;
}): {
  error: "RELEASE_DEPLOYMENT_FAILED" | "RELEASE_DEPLOYMENT_DRIFT";
  reason: ReleaseDeploymentFailureCode;
  message: string;
} {
  const reason = releaseDeploymentFailureCode(outcome);
  const because = `Deployment failed: ${EXPLANATIONS[reason]} (${reason}).`;
  if (outcome.deploymentDrift) {
    return {
      error: "RELEASE_DEPLOYMENT_DRIFT",
      reason,
      message: `${because} The previous activation could not be restored. The storefront requires reconciliation.`,
    };
  }
  return {
    error: "RELEASE_DEPLOYMENT_FAILED",
    reason,
    message: BUILD_SHAPE_CODES.has(reason)
      ? `${because} The previous activation was restored; change the Theme and publish again.`
      : `${because} The previous activation was restored; reload and retry publishing.`,
  };
}
