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

/**
 * Whether a publish has nothing left to do.
 *
 * Content identity alone is not enough. A publish writes D1 and then deploys;
 * if the deploy failed, every identity below still matches on the retry, so
 * reporting "already published" skipped the deploy and left the active release
 * naming a build the Worker never received. The only way out was to change the
 * content so the identities differed — which is not a recovery, it is a
 * workaround for a state the publish refused to re-enter.
 *
 * So the deployed build is part of the question.
 */
export function isPublishAlreadyLive(args: {
  templateUnchanged: boolean;
  sourceUnchanged: boolean;
  activeReleaseSourceRevisionId: string | null | undefined;
  activeReleaseThemeBuildId: string | null | undefined;
  deployedThemeBuildId: string | null | undefined;
  sourceRevisionId: string | null | undefined;
  themeBuildId: string | null | undefined;
}): boolean {
  return (
    args.templateUnchanged &&
    args.sourceUnchanged &&
    args.activeReleaseSourceRevisionId === args.sourceRevisionId &&
    args.activeReleaseThemeBuildId === args.themeBuildId &&
    canSkipThemeWorkerDeployment({
      deployedThemeBuildId: args.deployedThemeBuildId,
      releaseThemeBuildId: args.themeBuildId,
    })
  );
}

/**
 * Key, in a release's metadata, of the build whose last successful deploy
 * for this release installed Morph's release/Worker build match module
 * (`theme-worker-build-match.ts`). Absent when that deploy did not, so a
 * release deployed before the check, or with the switch off, carries none.
 */
export const DEPLOYED_THEME_BUILD_MATCH_METADATA_KEY = "deployedThemeBuildMatchId";

/** The build recorded as deployed with the match module, or `null`. */
export function readDeployedThemeBuildMatchId(
  metadata: StorefrontDeploymentMetadata | null | undefined,
): string | null {
  const value = metadata?.[DEPLOYED_THEME_BUILD_MATCH_METADATA_KEY];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * Whether a release's Worker must confirm the build it serves: its last
 * successful deploy installed the match module, for this release's build.
 */
export function isThemeBuildMatchMarked(
  metadata: StorefrontDeploymentMetadata | null | undefined,
  themeBuildId: string,
): boolean {
  return readDeployedThemeBuildMatchId(metadata) === themeBuildId;
}

/**
 * Metadata after a successful deploy: marked with the build when the deploy
 * installed the match module, the mark removed when it did not. Returns the
 * input unchanged (same object) when nothing changes, so a deploy with the
 * switch off writes nothing new to a release that never had a mark.
 */
export function withDeployedThemeBuildMatch<
  T extends StorefrontDeploymentMetadata,
>(metadata: T | null | undefined, buildMatchId: string | null): T | null | undefined {
  const current = readDeployedThemeBuildMatchId(metadata);
  if (buildMatchId === null) {
    if (!metadata || !(DEPLOYED_THEME_BUILD_MATCH_METADATA_KEY in metadata)) {
      return metadata;
    }
    const { [DEPLOYED_THEME_BUILD_MATCH_METADATA_KEY]: _removed, ...rest } =
      metadata;
    return rest as T;
  }
  if (current === buildMatchId) return metadata;
  return {
    ...(metadata ?? ({} as T)),
    [DEPLOYED_THEME_BUILD_MATCH_METADATA_KEY]: buildMatchId,
  };
}
