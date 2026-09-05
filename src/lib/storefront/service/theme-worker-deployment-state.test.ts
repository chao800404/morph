import { describe, expect, it } from "vitest";
import {
  canSkipThemeWorkerDeployment,
  isPublishAlreadyLive,
  readDeployedThemeBuildId,
  withDeployedThemeBuildId,
} from "./theme-worker-deployment-state";

describe("theme worker deployment state", () => {
  it("skips only when the Worker already runs exactly this build", () => {
    expect(
      canSkipThemeWorkerDeployment({
        deployedThemeBuildId: "bld_1",
        releaseThemeBuildId: "bld_1",
      }),
    ).toBe(true);
  });

  it("deploys when nothing has ever been recorded", () => {
    // The active release is not evidence of what the Worker received: a deploy
    // can fail after the release is activated. An unrecorded storefront must
    // always deploy.
    expect(
      canSkipThemeWorkerDeployment({
        deployedThemeBuildId: null,
        releaseThemeBuildId: "bld_1",
      }),
    ).toBe(false);
  });

  it("deploys when the recorded build differs", () => {
    expect(
      canSkipThemeWorkerDeployment({
        deployedThemeBuildId: "bld_1",
        releaseThemeBuildId: "bld_2",
      }),
    ).toBe(false);
  });

  it("deploys rather than trusting a blank or missing id", () => {
    for (const [deployed, target] of [
      ["", "bld_1"],
      ["   ", "bld_1"],
      ["bld_1", ""],
      ["bld_1", undefined],
      [undefined, undefined],
    ] as const) {
      expect(
        canSkipThemeWorkerDeployment({
          deployedThemeBuildId: deployed,
          releaseThemeBuildId: target,
        }),
      ).toBe(false);
    }
  });

  it("reads the recorded build back out of storefront metadata", () => {
    expect(readDeployedThemeBuildId({ deployedThemeBuildId: "bld_9" })).toBe(
      "bld_9",
    );
    expect(readDeployedThemeBuildId({})).toBeNull();
    expect(readDeployedThemeBuildId(null)).toBeNull();
    expect(readDeployedThemeBuildId({ deployedThemeBuildId: 42 })).toBeNull();
  });

  it("records without discarding unrelated storefront metadata", () => {
    expect(
      withDeployedThemeBuildId({ accessMode: "private" }, "bld_2"),
    ).toEqual({ accessMode: "private", deployedThemeBuildId: "bld_2" });
  });
});
describe("isPublishAlreadyLive (REL-02)", () => {
  const live = {
    templateUnchanged: true,
    sourceUnchanged: true,
    activeReleaseSourceRevisionId: "src_1",
    activeReleaseThemeBuildId: "bld_1",
    deployedThemeBuildId: "bld_1",
    sourceRevisionId: "src_1",
    themeBuildId: "bld_1",
  } as const;

  it("is true only when the Worker is running this exact build", () => {
    expect(isPublishAlreadyLive(live)).toBe(true);
  });

  // The reported bug: D1 said published, the deploy had failed, and the retry
  // short-circuited without deploying. Nothing but editing the content could
  // get the storefront out of that state.
  it("is false when the deployment never landed", () => {
    expect(
      isPublishAlreadyLive({ ...live, deployedThemeBuildId: null }),
    ).toBe(false);
    expect(
      isPublishAlreadyLive({ ...live, deployedThemeBuildId: "bld_old" }),
    ).toBe(false);
  });

  it("is false when anything about the content differs", () => {
    expect(isPublishAlreadyLive({ ...live, templateUnchanged: false })).toBe(
      false,
    );
    expect(isPublishAlreadyLive({ ...live, sourceUnchanged: false })).toBe(
      false,
    );
    expect(
      isPublishAlreadyLive({ ...live, activeReleaseSourceRevisionId: "other" }),
    ).toBe(false);
    expect(
      isPublishAlreadyLive({ ...live, activeReleaseThemeBuildId: "other" }),
    ).toBe(false);
  });

  it("is false when there is no build to compare", () => {
    expect(isPublishAlreadyLive({ ...live, themeBuildId: null })).toBe(false);
  });
});
