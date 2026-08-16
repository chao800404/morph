import type { StorefrontThemeBuildInput } from "@/lib/storefront/dto/storefront-theme-build.dto";
import { describe, expect, it } from "vitest";
import { FakeThemeBuildRunner } from "./fake-theme-build-runner";
import type { ThemeBuildRunner } from "./theme-build-runner.types";

describe("ThemeBuildRunner Abstraction (Phase 4B-4)", () => {
  const createMockInput = (
    overrides?: Partial<StorefrontThemeBuildInput>,
  ): StorefrontThemeBuildInput => ({
    buildId: "build-123",
    storefrontId: "storefront-1",
    themeId: "theme-1",
    sourceRevisionId: "rev-1",
    revisionNumber: 1,
    inputHash: "a".repeat(64),
    compilerId: "tailwind-v4-build",
    compilerVersion: "4.1.17",
    entry: "src/main.tsx",

    files: [
      {
        path: "src/styles/global.css",
        content: '@import "tailwindcss";',
        isEntry: false,
      },
      {
        path: "src/main.tsx",
        content: 'export default () => <h1>Hello World</h1>;',
        isEntry: true,
      },
    ],
    ...overrides,
  });

  it("conforms to ThemeBuildRunner interface with contract metadata", () => {
    const runner: ThemeBuildRunner = new FakeThemeBuildRunner({
      id: "custom-fake-runner",
      version: "2.0.0-test",
    });

    expect(runner.id).toBe("custom-fake-runner");
    expect(runner.version).toBe("2.0.0-test");
    expect(runner.isolation).toBe("fake-mock");
  });

  it("produces standard success result with manifest, bundle files, and durationMs", async () => {
    const runner = new FakeThemeBuildRunner();
    const input = createMockInput();

    const result = await runner.run(input);

    expect(result.success).toBe(true);
    expect(result.artifactPrefix).toBe("artifacts/build-123");
    expect(result.manifestJson).toBeDefined();
    expect(result.manifestJson?.entry).toBe("src/main.tsx");
    expect(result.manifestJson?.filesCount).toBe(2);
    expect(result.manifestJson?.inputHash).toBe("a".repeat(64));
    expect(result.manifestJson?.bundleFiles).toEqual([
      {
        path: "index.js",
        sizeBytes: 1024,
        mimeType: "application/javascript",
      },
      {
        path: "index.css",
        sizeBytes: 512,
        mimeType: "text/css",
      },
    ]);
    expect(result.logs?.length).toBeGreaterThan(0);
    expect(result.logs?.[0]?.level).toBe("info");
    expect(typeof result.durationMs).toBe("number");
  });

  it("produces failure result with errorMessage and diagnostics when shouldSucceed is false", async () => {
    const runner = new FakeThemeBuildRunner({
      shouldSucceed: false,
      errorMessage: "Vite build bundle failed: SyntaxError in src/main.tsx",
      diagnostics: {
        errors: [
          {
            severity: "error",
            message: "Unexpected token < at line 1",
            file: "src/main.tsx",
            line: 1,
            column: 15,
          },
        ],
      },
    });

    const input = createMockInput();
    const result = await runner.run(input);

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe(
      "Vite build bundle failed: SyntaxError in src/main.tsx",
    );
    expect(result.diagnosticsJson?.errors).toHaveLength(1);
    expect(result.diagnosticsJson?.errors?.[0]?.file).toBe("src/main.tsx");
    expect(result.logs?.[0]?.level).toBe("error");
  });

  it("throws exception when shouldThrow is true", async () => {
    const runner = new FakeThemeBuildRunner({
      shouldThrow: true,
      errorMessage: "Sandbox container terminated unexpectedly",
    });

    const input = createMockInput();

    await expect(runner.run(input)).rejects.toThrow(
      "Sandbox container terminated unexpectedly",
    );
  });

  it("respects delayMs and records accurate durationMs", async () => {
    const runner = new FakeThemeBuildRunner({
      delayMs: 35,
    });

    const input = createMockInput();
    const result = await runner.run(input);

    expect(result.success).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(30);
  });

  it("security invariant: treats untrusted customer code payloads strictly as immutable data without evaluation", async () => {
    let evaluated = false;

    // Simulate malicious customer theme code payload
    const untrustedCustomerPayload = `
      // Malicious attempt to touch global / runtime secrets
      (function() {
        if (typeof globalThis !== 'undefined') {
          globalThis.__LEAKED_SECRET__ = 'stolen';
        }
      })();
    `;

    const input = createMockInput({
      files: [
        {
          path: "src/malicious.tsx",
          content: untrustedCustomerPayload,
          isEntry: false,
        },
      ],
    });

    let receivedInputFilesCount = 0;
    const runner = new FakeThemeBuildRunner({
      onRun: (inp) => {
        receivedInputFilesCount = inp.files.length;
        // Verify input is received purely as data string without eval
        if (typeof (globalThis as any).__LEAKED_SECRET__ !== "undefined") {
          evaluated = true;
        }
      },
    });

    const result = await runner.run(input);

    expect(result.success).toBe(true);
    expect(receivedInputFilesCount).toBe(1);
    expect(evaluated).toBe(false);
    expect((globalThis as any).__LEAKED_SECRET__).toBeUndefined();
  });
});
