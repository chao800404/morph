// @vitest-environment node
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CloudflareSandboxVitePreviewServer,
  type StartPreviewServerInput,
} from "./cloudflare-sandbox-vite-preview-server";
import { LocalVitePreviewServer } from "./local-vite-preview-server";

// docs/astro-theme-plan.md, A1: the Live Preview chooses its adapter from the
// framework the Theme records. A framework Morph cannot preview is refused
// before anything is acquired, laid out or run, and is never previewed as
// TanStack Start.

const input = (
  overrides: Partial<StartPreviewServerInput>,
): StartPreviewServerInput => ({
  previewId: "preview-framework",
  files: [{ path: "src/index.tsx", content: "export default () => null;" }],
  entry: "src/index.tsx",
  previewHostname: "preview.example.com",
  platformHostEnv: undefined,
  ...overrides,
});

describe("a Live Preview of a framework Morph cannot preview", () => {
  it("is refused by the Sandbox transport before a container is acquired", async () => {
    let acquired = 0;
    const server = new CloudflareSandboxVitePreviewServer({
      sandboxProvider: {
        getSandbox: async () => {
          acquired += 1;
          throw new Error("a container was acquired");
        },
      },
    });

    const result = await server.start(input({ framework: "astro" }));

    expect(result.ok).toBe(false);
    expect(!result.ok && result.stage).toBe("preview-framework");
    expect(!result.ok && result.errorMessage).toMatch(
      /^THEME_FRAMEWORK_UNAVAILABLE: /,
    );
    expect(acquired).toBe(0);
  });

  it("is refused by the local transport before a workspace is laid out", async () => {
    // A root outside the checkout: anything past the framework check would
    // stop at LOCAL_PREVIEW_TOOLCHAIN_MISSING instead.
    const server = new LocalVitePreviewServer({
      workspacesRoot: path.join(os.tmpdir(), "morph-preview-framework-test"),
    });

    const result = await server.start(
      input({ previewHostname: "127.0.0.1", framework: "astro" }),
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.stage).toBe("preview-framework");
    expect(!result.ok && result.errorMessage).toMatch(
      /^THEME_FRAMEWORK_UNAVAILABLE: /,
    );
  });

  it("reaches the transport's own checks when the Theme records TanStack Start, or nothing", async () => {
    const server = new LocalVitePreviewServer({
      workspacesRoot: path.join(os.tmpdir(), "morph-preview-framework-test"),
    });
    for (const framework of ["tanstack-start" as const, undefined]) {
      const result = await server.start(
        input({ previewHostname: "127.0.0.1", framework }),
      );
      expect(!result.ok && result.stage).toBe("preview-toolchain");
    }
  });
});
