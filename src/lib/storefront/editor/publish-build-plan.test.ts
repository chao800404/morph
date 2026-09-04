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
        activeReleaseSourceGeneration: 7,
      }),
    ).toEqual({ action: "reuse-build" });
  });

  it("builds again when the source moved on after the build", () => {
    expect(
      resolvePublishBuildPlan({
        hasBuild: true,
        buildSourceGeneration: 7,
        currentSourceGeneration: 8,
        activeReleaseSourceGeneration: 7,
      }),
    ).toEqual({ action: "build" });
  });

  it("builds for a first release, since nothing has been built yet", () => {
    expect(
      resolvePublishBuildPlan({
        hasBuild: false,
        buildSourceGeneration: null,
        currentSourceGeneration: 1,
        activeReleaseSourceGeneration: null,
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
        activeReleaseSourceGeneration: 3,
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
        activeReleaseSourceGeneration: 4,
      }),
    ).toEqual({ action: "build" });
  });

  it("prefers its own build over the active release", () => {
    expect(
      resolvePublishBuildPlan({
        hasBuild: true,
        buildSourceGeneration: 2,
        currentSourceGeneration: 2,
        activeReleaseSourceGeneration: null,
      }),
    ).toEqual({ action: "reuse-build" });
  });

  it("builds when the Theme was edited but never built", () => {
    // The case that sent people to press Build themselves: source edited past
    // the release, no build held. Reusing the release here ships the artifact
    // from before the edit, and the server refuses it — so the plan has to
    // build rather than propose something publishing will reject.
    expect(
      resolvePublishBuildPlan({
        hasBuild: false,
        buildSourceGeneration: null,
        currentSourceGeneration: 4,
        activeReleaseSourceGeneration: 3,
      }),
    ).toEqual({ action: "build" });
  });

  it("builds when the release's source generation is unknown", () => {
    expect(
      resolvePublishBuildPlan({
        hasBuild: false,
        buildSourceGeneration: null,
        currentSourceGeneration: 4,
        activeReleaseSourceGeneration: null,
      }),
    ).toEqual({ action: "build" });
  });
});
