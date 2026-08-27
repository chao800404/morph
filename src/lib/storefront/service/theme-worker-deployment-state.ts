/**
 * What the Theme Worker is actually running, as opposed to what D1 says should
 * be live.
 *
 * A publish that only changes content reuses the build that is already
 * deployed, so redeploying is pure cost — a container start and a wrangler
 * upload of bytes the Worker already serves. Skipping it safely needs the
 * deployed build recorded somewhere, because the active release is not
 * evidence: a deployment can fail after the release is activated, leaving D1
 * pointing at a build the Worker never received.
 *
 * Recorded on the release whose artifact was deployed. The storefront's own
 * metadata column is user-facing preferences, and a preferences write would
 * drop anything the platform hid there.
 */

/** Key the deployed build id is stored under in a release's metadata. */
export const DEPLOYED_THEME_BUILD_METADATA_KEY = "deployedThemeBuildId";

export type StorefrontDeploymentMetadata = Record<string, unknown>;


/** Build the Worker was last successfully given, or `null` if never recorded. */
export function readDeployedThemeBuildId(
  metadata: StorefrontDeploymentMetadata | null | undefined,
): string | null {
  const value = metadata?.[DEPLOYED_THEME_BUILD_METADATA_KEY];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * Whether a release can go live without touching the Theme Worker.
 *
 * True only when the Worker is recorded as already running exactly this build.
 * Every uncertain case — nothing recorded, a different build, a missing id —
 * deploys, because a redundant deploy costs time while a skipped one that was
 * needed leaves the storefront serving the wrong bytes with no error anywhere.
 */
export function canSkipThemeWorkerDeployment(args: {
  deployedThemeBuildId: string | null | undefined;
  releaseThemeBuildId: string | null | undefined;
}): boolean {
  const deployed = args.deployedThemeBuildId;
  const target = args.releaseThemeBuildId;
  if (typeof deployed !== "string" || deployed.trim() === "") return false;
  if (typeof target !== "string" || target.trim() === "") return false;
  return deployed === target;
}

/**
 * Metadata to persist after a deployment succeeded.
 *
 * Written only on success: recording an attempt would make the next publish
 * skip a deploy that never landed.
 */
export function withDeployedThemeBuildId<
  T extends StorefrontDeploymentMetadata,
>(metadata: T | null | undefined, themeBuildId: string): T {
  return {
    ...(metadata ?? ({} as T)),
    [DEPLOYED_THEME_BUILD_METADATA_KEY]: themeBuildId,
  };
}
