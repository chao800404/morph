import { describe, it } from "vitest";
import { buildPreviewSandboxName } from "./build-preview/cloudflare-sandbox-build-preview-server";
import { deploymentSandboxSessionId } from "./sandbox-wrangler-theme-worker-deployer";
import { expectValidSandboxId } from "./sandbox-id.test-support";
import { deriveThemePreviewSessionId } from "./theme-preview-session-id";

/**
 * Every id Morph hands to `getSandbox` must pass the SDK's id rule when built
 * from real UUIDs. Unit tests elsewhere inject fake sandbox providers, which
 * is how a deploy id of 80 characters reached staging.
 */
describe("sandbox ids built from real UUIDs", () => {
  it("deployment id", async () => {
    expectValidSandboxId(
      await deploymentSandboxSessionId(
        crypto.randomUUID(),
        crypto.randomUUID(),
      ),
    );
  });

  it("live preview id", async () => {
    expectValidSandboxId(
      await deriveThemePreviewSessionId({
        storefrontId: crypto.randomUUID(),
        themeId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      }),
    );
  });

  it("build preview id (capability id)", () => {
    expectValidSandboxId(buildPreviewSandboxName(crypto.randomUUID()));
  });

  it("theme build id (build runner and terminator use the build id as is)", () => {
    // storefront-theme-build.dal.ts mints build ids with crypto.randomUUID().
    expectValidSandboxId(crypto.randomUUID());
  });

  it("dev byte round-trip id", () => {
    expectValidSandboxId(`byte-roundtrip-${crypto.randomUUID()}`);
  });
});
