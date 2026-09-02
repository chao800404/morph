import { describe, expect, it } from "vitest";
import { resolvePublishBuildPlan } from "./publish-build-plan";

describe("resolvePublishBuildPlan", () => {
  it("reuses a build made from the source being published", () => {
    // Releasing the artifact that was already verified is what keeps what
    // ships identical to what was previewed.
    expect(
      resolvePublishBuildPlan({
        hasBuild: true,
        buildSourceGeneration: 7,
        currentSourceGeneration: 7,
        hasActiveRelease: true,
      }),
    ).toEqual({ action: "reuse-build" });
  });

  it("builds again when the source moved on after the build", () => {
    expect(
      resolvePublishBuildPlan({
        hasBuild: true,
        buildSourceGeneration: 7,
        currentSourceGeneration: 8,
        hasActiveRelease: true,
      }),
    ).toEqual({ action: "build" });
  });

  it("builds for a first release, since nothing has been built yet", () => {
    expect(
      resolvePublishBuildPlan({
        hasBuild: false,
        buildSourceGeneration: null,
        currentSourceGeneration: 1,
        hasActiveRelease: false,
      }),
    ).toEqual({ action: "build" });
  });

  it("republishes content on the released artifact when no build is held", () => {
    // Content-only publishing: the Theme was not touched, so the artifact the
    // active release already serves still matches.
    expect(
      resolvePublishBuildPlan({
        hasBuild: false,
        buildSourceGeneration: null,
        currentSourceGeneration: 3,
        hasActiveRelease: true,
      }),
    ).toEqual({ action: "reuse-release" });
  });

  it("builds when a held build never recorded which source it came from", () => {
    // Without a generation there is no way to claim it matches, and guessing
    // would publish an artifact that may not correspond to the source.
    expect(
      resolvePublishBuildPlan({
        hasBuild: true,
        buildSourceGeneration: null,
        currentSourceGeneration: 4,
        hasActiveRelease: true,
      }),
    ).toEqual({ action: "build" });
  });

  it("prefers its own build over the active release", () => {
    expect(
      resolvePublishBuildPlan({
        hasBuild: true,
        buildSourceGeneration: 2,
        currentSourceGeneration: 2,
        hasActiveRelease: false,
      }),
    ).toEqual({ action: "reuse-build" });
  });
});
