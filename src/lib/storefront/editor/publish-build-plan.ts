/**
 * What publishing has to do about the Theme artifact before it can release.
 *
 * `build` is not an error path. Producing the artifact is a step of publishing,
 * so a missing or outdated one is something publishing does, not something the
 * person is told to go and do first.
 */
export type PublishBuildPlan =
  /** An existing build already matches the source being published. */
  | { action: "reuse-build" }
  /** No build of its own, but the active release's artifact still matches. */
  | { action: "reuse-release" }
  /** Nothing usable exists: publishing must build first. */
  | { action: "build" };

export type PublishBuildPlanInput = {
  /** Non-SSR HTML depends on content as well as source; seal and build anew. */
  requiresContentBuild?: boolean;
  /** A build the editor is currently holding, if any. */
  hasBuild: boolean;
  /** Source generation that build was made from. */
  buildSourceGeneration: number | null;
  /**
   * False when that build carries a content snapshot that is not the content
   * being published — a Build Preview sealed the drafts, and they have been
   * edited since. Such a build shows a store that is not the one being
   * published, so it is rebuilt rather than reused (the server would refuse
   * it anyway, `PUBLISH_BUILD_CONTENT_MISMATCH`). True, or absent, when the
   * build carries no content or the same content.
   */
  buildContentCurrent?: boolean;
  /** Source generation being published. */
  currentSourceGeneration: number;
  /**
   * Source generation the active release's artifact was built from, or null
   * when this theme has never been released.
   *
   * Needed rather than a plain "has a release" flag because publishing refuses
   * to reuse a release whose artifact was built from older source, and a plan
   * that chooses a path the server will reject is worse than no plan: the
   * person is told to go and build, which is the step this was meant to remove.
   */
  activeReleaseSourceGeneration: number | null;
};

/**
 * Decides whether publishing can reuse an artifact or has to make one.
 *
 * Reuse is preferred wherever it is honest: releasing the artifact that was
 * already verified is what keeps what ships identical to what was previewed,
 * and rebuilding for its own sake reintroduces the difference.
 */
export function resolvePublishBuildPlan({
  requiresContentBuild,
  hasBuild,
  buildSourceGeneration,
  buildContentCurrent,
  currentSourceGeneration,
  activeReleaseSourceGeneration,
}: PublishBuildPlanInput): PublishBuildPlan {
  // Source alone cannot prove an artifact contains the current content.
  // Server-side publication comparison remains the final authority.
  if (requiresContentBuild) return { action: "build" };
  if (hasBuild) {
    // A build made from different source, or sealed with different content,
    // describes a store that no longer exists, so it cannot stand in for the
    // one being published.
    return buildSourceGeneration === currentSourceGeneration &&
      buildContentCurrent !== false
      ? { action: "reuse-build" }
      : { action: "build" };
  }

  // Republishing an existing release without touching the Theme is a content
  // change: the released artifact still matches the source it was built from.
  // The generations have to agree for that to be true — editing the Theme and
  // pressing Publish without building leaves a release whose artifact predates
  // the edit, and publishing it would ship the old store under the new source.
  return activeReleaseSourceGeneration === currentSourceGeneration
    ? { action: "reuse-release" }
    : { action: "build" };
}
