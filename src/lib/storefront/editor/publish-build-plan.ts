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
  /** A build the editor is currently holding, if any. */
  hasBuild: boolean;
  /** Source generation that build was made from. */
  buildSourceGeneration: number | null;
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
  hasBuild,
  buildSourceGeneration,
  currentSourceGeneration,
  activeReleaseSourceGeneration,
}: PublishBuildPlanInput): PublishBuildPlan {
  if (hasBuild) {
    // A build made from different source describes a store that no longer
    // exists, so it cannot stand in for the one being published.
    return buildSourceGeneration === currentSourceGeneration
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
