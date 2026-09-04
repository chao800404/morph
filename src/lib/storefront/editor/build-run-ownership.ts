export interface BuildRunState {
  /** Any build is in flight, whoever started it. */
  isBuildPending: boolean;
  /** That build was started by publishing, for itself. */
  isPublishBuilding: boolean;
}

export interface BuildRunOwnership {
  /** The Build control shows a run, and may stop it. */
  buildOwnsRun: boolean;
  /** The Publish control shows a run. */
  publishOwnsRun: boolean;
}

/**
 * Which control is reporting the build that is running.
 *
 * Publishing builds when it needs to, so one job can otherwise light up two
 * controls at once — and the Build button, having no idea the run is not its
 * own, offers to cancel it while Publish is waiting on the result. Deciding
 * ownership in one place is what keeps the two from drifting apart again: this
 * has now been wrong in both directions, first with Publish reporting a build
 * it did not start, then with Build reporting one it did not start.
 */
export function resolveBuildRunOwnership({
  isBuildPending,
  isPublishBuilding,
}: BuildRunState): BuildRunOwnership {
  return {
    buildOwnsRun: isBuildPending && !isPublishBuilding,
    publishOwnsRun: isPublishBuilding,
  };
}
