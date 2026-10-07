// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {} }));

import { CloudflareSandboxViteThemeBuildRunner } from "./cloudflare-sandbox-vite-theme-build-runner";
import type { ThemeBuildRunnerInput } from "./theme-build-runner.types";

/**
 * Until a runner builds a native project with its own configuration, it
 * refuses one by name. Building it with the platform's configuration instead
 * would produce a different program from the one its author wrote. The local
 * runner builds it (native-start-runner.test.ts); the Sandbox runner is next.
 */
const nativeInput = {
  buildId: "build-native",
  storefrontId: "storefront-1",
  themeId: "theme-1",
  sourceRevisionId: "rev-native",
  revisionNumber: 1,
  entry: "src/index.tsx",
  inputHash: "hash",
  compilerId: "tanstack-start-native",
  compilerVersion: "1.168.32",
  files: [],
  buildMode: "native",
} as unknown as ThemeBuildRunnerInput;

describe("a build runner given a native project", () => {
  it("is refused by the Sandbox runner, before anything runs", async () => {
    const result = await new CloudflareSandboxViteThemeBuildRunner({
      sandboxBinding: {} as never,
    }).run(nativeInput);
    expect(result).toMatchObject({
      success: false,
      errorMessage: expect.stringMatching(
        /^NATIVE_START_BUILD_RUNNER_PENDING: /,
      ),
    });
  });
});
