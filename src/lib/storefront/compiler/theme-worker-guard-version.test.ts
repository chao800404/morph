// @vitest-environment node
import { describe, expect, it } from "vitest";
import { TAILWIND_VERSION } from "./tailwind-builtin-stylesheets";
import {
  buildHideGuardVersion,
  withThemeManagedStartBuildIdentity,
  withThemeMorphSdkIdentity,
  withThemeStartBuildIdentity,
} from "./theme-morph-sdk";
import {
  THEME_WORKER_GUARD_VERSION,
  THEME_WORKER_GUARDED_COMPILER_IDS,
  buildWorkerGuardVersion,
  workerGuardPublishProblem,
} from "./theme-worker-guard-version";
import { LocalViteThemeBuildRunner } from "./local-vite-theme-build-runner";
import {
  NATIVE_ASTRO_COMPILER_ID,
  nativeAstroCompilerIdentity,
} from "../theme-framework/astro-native-build";
import { THEME_START_TOOLCHAIN } from "./theme-start-toolchain";
import { themeFramework } from "../theme-framework";

describe("the Web Worker guard in the build identity", () => {
  it("is carried by the managed Start build and the native Astro build", () => {
    const managed = new LocalViteThemeBuildRunner();
    expect(buildWorkerGuardVersion(managed.compilerVersion)).toBe(
      THEME_WORKER_GUARD_VERSION,
    );
    expect(managed.compilerVersion).toBe(
      withThemeManagedStartBuildIdentity(TAILWIND_VERSION),
    );
    // The hide guard is still read from the same version.
    expect(buildHideGuardVersion(managed.compilerVersion)).toBe(
      buildHideGuardVersion(withThemeStartBuildIdentity(TAILWIND_VERSION)),
    );
    expect(buildWorkerGuardVersion(nativeAstroCompilerIdentity().version)).toBe(
      THEME_WORKER_GUARD_VERSION,
    );
    expect([...THEME_WORKER_GUARDED_COMPILER_IDS].sort()).toEqual(
      [managed.compilerId, NATIVE_ASTRO_COMPILER_ID].sort(),
    );
  });

  it("is not claimed by the native Start build, which does not carry it yet", () => {
    const native =
      themeFramework("tanstack-start").build.native.compilerIdentity();
    expect(
      native.version.startsWith(
        withThemeStartBuildIdentity(THEME_START_TOOLCHAIN.reactStart),
      ),
    ).toBe(true);
    expect(buildWorkerGuardVersion(native.version)).toBeNull();
    expect(THEME_WORKER_GUARDED_COMPILER_IDS.has(native.id)).toBe(false);
  });

  it("fits the 50-character compiler_version column", () => {
    for (const version of [
      new LocalViteThemeBuildRunner().compilerVersion,
      nativeAstroCompilerIdentity().version,
    ]) {
      expect(version.length).toBeLessThanOrEqual(50);
    }
  });

  it("refuses to publish a guarded compiler's build that records an older guard, or none", () => {
    expect(
      workerGuardPublishProblem({
        compilerId: "tailwind-v4-build",
        compilerVersion: withThemeStartBuildIdentity(TAILWIND_VERSION),
      }),
    ).toMatch(/no worker guard/);
    expect(
      workerGuardPublishProblem({
        compilerId: "astro-native",
        compilerVersion: `${withThemeMorphSdkIdentity("7.3.5")}.wg-0`,
      }),
    ).toMatch(/worker guard wg-0/);
    expect(
      workerGuardPublishProblem({
        compilerId: "tailwind-v4-build",
        compilerVersion: withThemeManagedStartBuildIdentity(TAILWIND_VERSION),
      }),
    ).toBeNull();
    // Not a compiler that carries the guard: nothing to require.
    expect(
      workerGuardPublishProblem({
        compilerId: "start-native",
        compilerVersion: withThemeStartBuildIdentity("1.168.32"),
      }),
    ).toBeNull();
  });
});
