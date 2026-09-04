import { describe, expect, it } from "vitest";

import { resolveBuildRunOwnership } from "./build-run-ownership";

describe("resolveBuildRunOwnership", () => {
  it("gives a build the person started to the Build control", () => {
    expect(
      resolveBuildRunOwnership({
        isBuildPending: true,
        isPublishBuilding: false,
      }),
    ).toEqual({ buildOwnsRun: true, publishOwnsRun: false });
  });

  it("gives a build publishing started to Publish alone", () => {
    // The Build control must stay idle here. It offers "cancel" while a run is
    // its own, and cancelling this one would stop the build Publish is
    // waiting on.
    expect(
      resolveBuildRunOwnership({
        isBuildPending: true,
        isPublishBuilding: true,
      }),
    ).toEqual({ buildOwnsRun: false, publishOwnsRun: true });
  });

  it("never lets one run light up both controls", () => {
    for (const isBuildPending of [true, false]) {
      for (const isPublishBuilding of [true, false]) {
        const { buildOwnsRun, publishOwnsRun } = resolveBuildRunOwnership({
          isBuildPending,
          isPublishBuilding,
        });
        expect(buildOwnsRun && publishOwnsRun).toBe(false);
      }
    }
  });

  it("reports nothing running when nothing is", () => {
    expect(
      resolveBuildRunOwnership({
        isBuildPending: false,
        isPublishBuilding: false,
      }),
    ).toEqual({ buildOwnsRun: false, publishOwnsRun: false });
  });
});
