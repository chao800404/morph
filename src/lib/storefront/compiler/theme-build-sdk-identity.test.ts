// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

/**
 * A build names the Morph SDK it was built with (theme-morph-sdk.ts).
 *
 * The SDK is injected by the platform, not part of the Theme's revision, so
 * these tests hold the revision fixed and change only the SDK: the hash the
 * generator emits, and the copied files themselves. Read through getters, so
 * each test can say which SDK this Morph would inject.
 */
const sdk = vi.hoisted(() => ({
  hash: null as string | null,
  sources: null as ReadonlyArray<{ path: string; content: string }> | null,
}));
vi.mock("./morph-sdk-sources.generated", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("./morph-sdk-sources.generated")>();
  return {
    get MORPH_SDK_SOURCE_HASH() {
      return sdk.hash ?? real.MORPH_SDK_SOURCE_HASH;
    },
    get GENERATED_MORPH_SDK_SOURCES() {
      return sdk.sources ?? real.GENERATED_MORPH_SDK_SOURCES;
    },
  };
});

import { STARTER_THEME_FILES } from "@/lib/storefront/starter-theme-files";
import { themeToolchainForFramework } from "@/lib/storefront/theme-framework/theme-toolchains";
import { tanstackStartFramework } from "@/lib/storefront/theme-framework/tanstack-start.framework";
import { CloudflareSandboxViteThemeBuildRunner } from "./cloudflare-sandbox-vite-theme-build-runner";
import { LocalViteThemeBuildRunner } from "./local-vite-theme-build-runner";
import { GENERATED_MORPH_SDK_SOURCES } from "./morph-sdk-sources.generated";
import { DEFAULT_APPROVED_DEPENDENCIES } from "./sandbox-vite-theme-build-runner.types";
import { TAILWIND_VERSION } from "./tailwind-builtin-stylesheets";
import { materializeThemeBuildInput } from "./theme-build-materializer";
import {
  planThemeSandboxWorkspace,
  themeWorkspaceFingerprint,
} from "./theme-sandbox-workspace";
import { THEME_START_TOOLCHAIN } from "./theme-start-toolchain";

const SDK_A = "a".repeat(64);
const SDK_B = "b".repeat(64);

function withSdk<T>(hash: string, run: () => T): T {
  sdk.hash = hash;
  try {
    return run();
  } finally {
    sdk.hash = null;
  }
}

const REVISION = {
  id: "rev-sdk",
  storefrontId: "storefront-sdk",
  themeId: "theme-sdk",
  revisionNumber: 1,
  snapshot: STARTER_THEME_FILES,
};

/** A queued build, recorded the way requestPreviewBuild records one. */
function queuedBuild(overrides: Record<string, unknown> = {}) {
  return {
    id: "build-sdk",
    storefrontId: "storefront-sdk",
    themeId: "theme-sdk",
    sourceRevisionId: "rev-sdk",
    status: "queued",
    inputHash: null,
    compilerId: null,
    compilerVersion: null,
    framework: "tanstack-start",
    inputHashFormat: 2,
    toolchainId: themeToolchainForFramework("tanstack-start").id,
    dependencies: null,
    contentPublicationId: null,
    ...overrides,
  } as never;
}

const materialize = (build = queuedBuild()) =>
  materializeThemeBuildInput({ build, revision: REVISION as never });

describe("a Theme build's identity names the Morph SDK it injects", () => {
  it("changes when only the SDK changes, for the same revision", () => {
    const a = withSdk(SDK_A, () => materialize());
    const b = withSdk(SDK_B, () => materialize());

    expect(a.compilerVersion).toBe(`${TAILWIND_VERSION}+morph-sdk.${"a".repeat(16)}`);
    expect(b.compilerVersion).toBe(`${TAILWIND_VERSION}+morph-sdk.${"b".repeat(16)}`);
    // The three fields findSucceededBuildByIdentity matches on besides the
    // revision: a build under another SDK can never be handed back as this one.
    expect(b.inputHash).not.toBe(a.inputHash);
    expect(b.compilerId).toBe(a.compilerId);
    // The revision's own files are the same either way; only the identity moved.
    expect(b.files).toEqual(a.files);
  });

  it("stays the same for the same SDK", () => {
    const first = withSdk(SDK_A, () => materialize());
    const second = withSdk(SDK_A, () => materialize());
    expect(second.inputHash).toBe(first.inputHash);
    expect(second.compilerVersion).toBe(first.compilerVersion);
  });

  it("is the real generated hash by default, within the recorded column's input limit", () => {
    const input = materialize();
    expect(input.compilerVersion).toMatch(
      /^\d+\.\d+\.\d+\+morph-sdk\.[0-9a-f]{16}$/,
    );
    expect(input.compilerVersion.length).toBeLessThanOrEqual(50);
  });

  it("names the SDK in a native Start build's identity too", () => {
    const a = withSdk(SDK_A, () =>
      tanstackStartFramework.build.native!.compilerIdentity(),
    );
    const b = withSdk(SDK_B, () =>
      tanstackStartFramework.build.native!.compilerIdentity(),
    );
    expect(a.version).toBe(
      `${THEME_START_TOOLCHAIN.reactStart}+morph-sdk.${"a".repeat(16)}`,
    );
    expect(b.version).not.toBe(a.version);
    expect(b.id).toBe(a.id);
  });

  it("is what both build runners expect, so a build materialized here is accepted there", () => {
    const expected = materialize().compilerVersion;
    expect(new LocalViteThemeBuildRunner().compilerVersion).toBe(expected);
    expect(
      new CloudflareSandboxViteThemeBuildRunner({} as never).compilerVersion,
    ).toBe(expected);
  });

  it("keeps a recorded build verifiable after the SDK changes: its identity is frozen on the record", () => {
    const started = withSdk(SDK_A, () => materialize());
    const recorded = queuedBuild({
      status: "succeeded",
      inputHash: started.inputHash,
      compilerId: started.compilerId,
      compilerVersion: started.compilerVersion,
    });
    // Re-materialized by a Morph that now injects another SDK: the record
    // still names SDK A and its hash still verifies (no INPUT_HASH_MISMATCH).
    const again = withSdk(SDK_B, () => materialize(recorded));
    expect(again.compilerVersion).toBe(started.compilerVersion);
    expect(again.inputHash).toBe(started.inputHash);
  });
});

describe("a Start preview's workspace reuse key covers the SDK copy", () => {
  const fingerprint = () => {
    const planned = planThemeSandboxWorkspace({
      files: STARTER_THEME_FILES,
      entry: "src/routes/index.tsx",
      buildId: "sdk-preview",
      approvedDependencies: new Set(DEFAULT_APPROVED_DEPENDENCIES),
      mode: "preview-server",
      previewRuntime: "client",
      toolchainRoot: process.cwd(),
    });
    if (!planned.ok) throw new Error(planned.errorMessage);
    return themeWorkspaceFingerprint(planned.workspaceFiles);
  };

  it("changes when a copied SDK file changes, and not otherwise", () => {
    const before = fingerprint();
    expect(fingerprint()).toBe(before);
    sdk.sources = GENERATED_MORPH_SDK_SOURCES.map((file, index) =>
      index === 0 ? { ...file, content: `${file.content}\n// changed\n` } : file,
    );
    try {
      expect(fingerprint()).not.toBe(before);
    } finally {
      sdk.sources = null;
    }
  });
});
