import type { R2BucketLike } from "../compiler/cloudflare-r2-theme-build-artifact-store";
import type { CanonicalThemeBuildManifest } from "../compiler/theme-build-artifact-store.types";
import { planThemeWorkerDeployment } from "./theme-worker-deployment-plan";
import type { ThemeWorkerDeployer } from "./theme-worker-deployer.types";

/**
 * Path of the Worker config the build toolchain generates inside the artifact.
 * It is read from the immutable artifact rather than regenerated, so what is
 * deployed always matches what was actually built.
 */
const GENERATED_WORKER_CONFIG_PATH = "runtime/server/wrangler.json";

export type ReleaseActivationFailureReason =
  | "RELEASE_NOT_FOUND"
  | "BUILD_NOT_DEPLOYABLE"
  | "WORKER_CONFIG_UNREADABLE"
  | "PLAN_REJECTED"
  | "DEPLOY_FAILED"
  | "ACTIVATION_CONFLICT";

export type ReleaseActivationResult =
  | {
      success: true;
      releaseId: string;
      scriptName: string;
      deploymentId: string | null;
    }
  | {
      success: false;
      reason: ReleaseActivationFailureReason;
      message: string;
      /**
       * True when the Theme Worker was replaced but D1 was not updated, so the
       * deployed bytes and `active_release_id` disagree and need reconciling.
       */
      deploymentDrift?: boolean;
    };

import {
  withDeploymentLease,
  type DeploymentLeasePorts,
} from "./deployment-lease";

export type ReleaseReconcilerPorts = Readonly<{
  getRelease(releaseId: string): Promise<{
    id: string;
    storefrontId: string;
    themeId: string;
    themeBuildId: string;
  } | null>;
  getBuild(buildId: string): Promise<{
    id: string;
    storefrontId: string;
    status: string;
    artifactPrefix: string | null;
    manifestJson: unknown;
  } | null>;
  activateRelease(args: {
    storefrontId: string;
    releaseId: string;
    expectedActiveReleaseId: string | null;
  }): Promise<unknown>;
  /**
   * Serialises deployments for one storefront.
   *
   * Optional so a caller that never deploys — a smoke harness, a test that
   * only exercises activation — is not forced to implement it. Production
   * wiring must provide it; without it the activate-and-deploy sequence is
   * only guarded at the pointer flip. See `deployment-lease.ts`.
   */
  deploymentLease?: DeploymentLeasePorts;
  /**
   * Records the build the Theme Worker now runs.
   *
   * Optional so a caller that never skips deployments — a smoke harness, a
   * test — is not forced to implement it. A caller that does skip must provide
   * it, or its next content-only publish would deploy again.
   */
  recordDeployedThemeBuild?(args: {
    storefrontId: string;
    releaseId: string;
    themeBuildId: string;
  }): Promise<unknown>;
}>;

async function readGeneratedWorkerConfig(
  r2Bucket: R2BucketLike | undefined,
  artifactPrefix: string,
): Promise<unknown | null> {
  if (!r2Bucket) return null;
  const object = await r2Bucket.get(
    `${artifactPrefix}/${GENERATED_WORKER_CONFIG_PATH}`,
  );
  if (!object) return null;
  const text =
    typeof (object as { text?: () => Promise<string> }).text === "function"
      ? await (object as { text: () => Promise<string> }).text()
      : typeof (object as { arrayBuffer?: () => Promise<ArrayBuffer> })
            .arrayBuffer === "function"
        ? new TextDecoder().decode(
            await (
              object as { arrayBuffer: () => Promise<ArrayBuffer> }
            ).arrayBuffer(),
          )
        : null;
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export type ReleaseDeploymentOutcome =
  | { success: true; scriptName: string; deploymentId: string | null }
  | {
      success: false;
      reason: Exclude<ReleaseActivationFailureReason, "ACTIVATION_CONFLICT">;
      message: string;
    };

/**
 * Deploys one release's immutable artifact as the storefront's Theme Worker.
 *
 * It only transports bytes: activation state is never read or written here, so
 * the same routine serves both the publish path (where D1 was already updated
 * atomically) and the rollback path (where activation is claimed first).
 */
export async function deployReleaseArtifact(args: {
  releaseId: string;
  deployer: ThemeWorkerDeployer;
  ports: Pick<ReleaseReconcilerPorts, "getRelease" | "getBuild">;
  r2Bucket?: R2BucketLike;
}): Promise<ReleaseDeploymentOutcome> {
  const release = await args.ports.getRelease(args.releaseId);
  if (!release) {
    return {
      success: false,
      reason: "RELEASE_NOT_FOUND",
      message: `Release "${args.releaseId}" was not found.`,
    };
  }

  const build = await args.ports.getBuild(release.themeBuildId);
  if (
    !build ||
    build.status !== "succeeded" ||
    !build.artifactPrefix ||
    !build.manifestJson
  ) {
    return {
      success: false,
      reason: "BUILD_NOT_DEPLOYABLE",
      message: `Release "${args.releaseId}" has no succeeded build artifact to deploy.`,
    };
  }

  if (build.storefrontId !== release.storefrontId) {
    return {
      success: false,
      reason: "BUILD_NOT_DEPLOYABLE",
      message: `Release "${args.releaseId}" references a build outside its storefront.`,
    };
  }

  const workerConfig = await readGeneratedWorkerConfig(
    args.r2Bucket,
    build.artifactPrefix,
  );
  if (workerConfig === null) {
    return {
      success: false,
      reason: "WORKER_CONFIG_UNREADABLE",
      message: `Build artifact is missing a readable "${GENERATED_WORKER_CONFIG_PATH}".`,
    };
  }

  const planned = planThemeWorkerDeployment({
    storefrontId: release.storefrontId,
    manifest: build.manifestJson as CanonicalThemeBuildManifest,
    workerConfig,
  });
  if (!planned.success) {
    return { success: false, reason: "PLAN_REJECTED", message: planned.message };
  }

  const deployed = await args.deployer.deploy({
    plan: planned.plan,
    artifactPrefix: build.artifactPrefix,
    storefrontId: release.storefrontId,
    releaseId: release.id,
    themeBuildId: build.id,
  });
  if (!deployed.success) {
    return {
      success: false,
      reason: "DEPLOY_FAILED",
      message: deployed.message,
    };
  }

  return {
    success: true,
    scriptName: planned.plan.scriptName,
    deploymentId: deployed.deploymentId,
  };
}

/**
 * Claims the active release, then deploys its immutable artifact.
 *
 * The storefront's service binding points at a stable script name, so replacing
 * that script is what actually changes production — a pointer flip cannot do
 * it. That makes concurrent activations dangerous, and the CAS on
 * `active_release_id` is used as the lock that prevents them:
 *
 *  1. Claim the slot with the CAS. A second activation loses here and never
 *     reaches the deployer, so two deployments can never race for one script.
 *  2. Deploy the artifact.
 *  3. If the deploy fails, release the claim by pointing `active_release_id`
 *     back at the previous release.
 *
 * Claiming first is deliberate. Deploying first would let two activations both
 * replace the script while only one CAS could win, leaving the loser's bytes
 * live under the winner's release id — divergence that nothing could detect.
 * The cost is a short window where `active_release_id` names a release whose
 * bytes are not deployed yet; during that window production still serves the
 * previous script, which is what a deployment looks like anyway.
 */
/**
 * Activates a release and deploys it, holding the storefront's deployment
 * lease for the whole sequence.
 *
 * The CAS inside only decides who may move the pointer; it says nothing about
 * who is uploading. Without the lease a second request reads the pointer the
 * first just wrote, passes its own CAS and deploys concurrently, and the
 * storefront ends up naming one release while running another's build.
 */
export async function activateReleaseWithDeployment(args: {
  releaseId: string;
  expectedActiveReleaseId: string | null;
  deployer: ThemeWorkerDeployer;
  ports: ReleaseReconcilerPorts;
  r2Bucket?: R2BucketLike;
}): Promise<ReleaseActivationResult> {
  const lease = args.ports.deploymentLease;
  if (!lease) return activateReleaseWithDeploymentUnsynchronised(args);

  const release = await args.ports.getRelease(args.releaseId);
  if (!release) {
    return {
      success: false,
      reason: "RELEASE_NOT_FOUND",
      message: `Release "${args.releaseId}" was not found.`,
    };
  }

  const held = await withDeploymentLease({
    storefrontId: release.storefrontId,
    owner: `activate:${args.releaseId}:${crypto.randomUUID()}`,
    ports: lease,
    operation: () => activateReleaseWithDeploymentUnsynchronised(args),
  });

  if (!held.acquired) {
    return {
      success: false,
      reason: "ACTIVATION_CONFLICT",
      message:
        "Another deployment is in progress for this storefront. Try again once it finishes.",
    };
  }
  return held.value;
}

async function activateReleaseWithDeploymentUnsynchronised(args: {
  releaseId: string;
  expectedActiveReleaseId: string | null;
  deployer: ThemeWorkerDeployer;
  ports: ReleaseReconcilerPorts;
  r2Bucket?: R2BucketLike;
}): Promise<ReleaseActivationResult> {
  const release = await args.ports.getRelease(args.releaseId);
  if (!release) {
    return {
      success: false,
      reason: "RELEASE_NOT_FOUND",
      message: `Release "${args.releaseId}" was not found.`,
    };
  }

  const build = await args.ports.getBuild(release.themeBuildId);
  if (
    !build ||
    build.status !== "succeeded" ||
    !build.artifactPrefix ||
    !build.manifestJson
  ) {
    return {
      success: false,
      reason: "BUILD_NOT_DEPLOYABLE",
      message: `Release "${args.releaseId}" has no succeeded build artifact to deploy.`,
    };
  }

  if (build.storefrontId !== release.storefrontId) {
    return {
      success: false,
      reason: "BUILD_NOT_DEPLOYABLE",
      message: `Release "${args.releaseId}" references a build outside its storefront.`,
    };
  }

  const workerConfig = await readGeneratedWorkerConfig(
    args.r2Bucket,
    build.artifactPrefix,
  );
  if (workerConfig === null) {
    return {
      success: false,
      reason: "WORKER_CONFIG_UNREADABLE",
      message: `Build artifact is missing a readable "${GENERATED_WORKER_CONFIG_PATH}".`,
    };
  }

  const planned = planThemeWorkerDeployment({
    storefrontId: release.storefrontId,
    manifest: build.manifestJson as CanonicalThemeBuildManifest,
    workerConfig,
  });
  if (!planned.success) {
    return {
      success: false,
      reason: "PLAN_REJECTED",
      message: planned.message,
    };
  }

  // 1. Claim the slot. Losing here means another activation is already in
  //    flight, and this one must not touch the deployed script.
  try {
    await args.ports.activateRelease({
      storefrontId: release.storefrontId,
      releaseId: release.id,
      expectedActiveReleaseId: args.expectedActiveReleaseId,
    });
  } catch (error) {
    return {
      success: false,
      reason: "ACTIVATION_CONFLICT",
      message:
        error instanceof Error
          ? error.message
          : "Another release was activated first.",
    };
  }

  // 2. Deploy the claimed release.
  const deployed = await args.deployer.deploy({
    plan: planned.plan,
    artifactPrefix: build.artifactPrefix,
    storefrontId: release.storefrontId,
    releaseId: release.id,
    themeBuildId: build.id,
  });

  if (!deployed.success) {
    // 3. Release the claim so D1 stops naming a release that was never
    //    deployed. Reverting to "no active release" is not expressible through
    //    the activation CAS, so a first-ever activation reports drift instead
    //    of silently leaving a release named with no script behind it.
    if (!args.expectedActiveReleaseId) {
      return {
        success: false,
        reason: "DEPLOY_FAILED",
        message: deployed.message,
        deploymentDrift: true,
      };
    }
    try {
      await args.ports.activateRelease({
        storefrontId: release.storefrontId,
        releaseId: args.expectedActiveReleaseId,
        expectedActiveReleaseId: release.id,
      });
      return {
        success: false,
        reason: "DEPLOY_FAILED",
        message: deployed.message,
      };
    } catch {
      return {
        success: false,
        reason: "DEPLOY_FAILED",
        message: deployed.message,
        deploymentDrift: true,
      };
    }
  }

  // 4. Record what the Worker now runs. Written only on success, and after the
  //    claim, so a later publish that changes nothing but content can skip a
  //    redeploy without treating activation alone as evidence.
  await args.ports.recordDeployedThemeBuild?.({
    storefrontId: release.storefrontId,
    releaseId: release.id,
    themeBuildId: build.id,
  });

  return {
    success: true,
    releaseId: release.id,
    scriptName: planned.plan.scriptName,
    deploymentId: deployed.deploymentId,
  };
}
