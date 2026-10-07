// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {} }));

import { CloudflareSandboxViteThemeBuildRunner } from "./cloudflare-sandbox-vite-theme-build-runner";
import { LocalViteThemeBuildRunner } from "./local-vite-theme-build-runner";
import type { ThemeBuildRunnerInput } from "./theme-build-runner.types";

/**
 * Until a runner builds a native project with its own configuration, it
 * refuses one by name. Building it with the platform's configuration instead
 * would produce a different program from the one its author wrote.
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
  it.each([
    ["the local runner", () => new LocalViteThemeBuildRunner()],
    [
      "the Sandbox runner",
      () =>
        new CloudflareSandboxViteThemeBuildRunner({
          sandboxBinding: {} as never,
        }),
    ],
  ])("is refused by %s, before anything runs", async (_name, create) => {
    const result = await create().run(nativeInput);
    expect(result).toMatchObject({
      success: false,
      errorMessage: expect.stringMatching(
        /^NATIVE_START_BUILD_RUNNER_PENDING: /,
      ),
    });
  });
});
