import { describe, expect, it, vi } from "vitest";
import {
  nativeBuildFailureMessage,
  nativeBuildResult,
  runNativeBuildPasses,
} from "./native-build-result";
import {
  NATIVE_PRERENDER_REFUSED_READS_PATH,
  type NativePrerenderContent,
} from "./theme-prerender-content";
import { themeFramework } from "../theme-framework";
import type {
  ThemeBuildRunnerInput,
  ThemeBuildRunnerResult,
} from "./theme-build-runner.types";

describe("a failed native build's message", () => {
  it("is what the build printed, when that is short", () => {
    expect(nativeBuildFailureMessage("✘ [ERROR] Could not resolve")).toBe(
      "NATIVE_BUILD_FAILED: ✘ [ERROR] Could not resolve",
    );
  });

  it("keeps the cause printed first as well as the error printed last", () => {
    // The shape of a prerender that failed: the server's own error, then the
    // Response Start threw on, dumped at length.
    const cause =
      "PRERENDER_SERVER_ERROR: GET /landing/: Error: listen EADDRINUSE";
    const consequence = "Error: Failed to fetch /landing: Internal Server Error";
    const output = `${cause}\n${"x".repeat(20_000)}\n${consequence}`;

    const message = nativeBuildFailureMessage(output);
    expect(message).toContain(cause);
    expect(message).toContain(consequence);
    expect(message).toContain("characters omitted");
    expect(message.length).toBeLessThan(9_000);
  });
});

/**
 * Starter 32 (and any Start Theme whose read failure is fatal) fails the
 * first, content-less pass of a native build: the prerender server refuses
 * the read and records it, the Theme rejects, Start's prerender gets a 500
 * and the build exits non-zero. Starter 31 hid this by rendering its
 * defaults on a refused read, so that pass exited 0 and the record alone
 * sent the build to its sealed pass.
 *
 * Traced on the real Starter 32 (native-start-runner.test.ts): the header
 * reached the SDK, the SDK reached /_morph/content, the first pass's file
 * holds no content (NATIVE_PRERENDER_WITHOUT_SNAPSHOT) and recorded the
 * refusal; then nativeBuildResult, given a failed build, asks only
 * `failedBuildCause`, which the Start adapter does not have. The refusal
 * is reported as "compiler", runNativeBuildPasses stops there, and the
 * sealed snapshot never reaches a prerender.
 */
describe("a native Start build whose prerender stopped on a refused content read", () => {
  const files = [
    {
      path: "src/routes/__root.tsx",
      content: `import { Outlet, createRootRoute } from "@tanstack/react-router";
export const Route = createRootRoute({ component: () => <Outlet /> });
`,
    },
    {
      path: "src/routes/landing.tsx",
      content: `import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/landing")({ component: () => null });
`,
    },
  ];
  const input = {
    buildId: "refused-read",
    storefrontId: "store",
    themeId: "theme",
    sourceRevisionId: "source",
    revisionNumber: 1,
    entry: "src/routes/index.tsx",
    inputHash: "c".repeat(64),
    compilerId: "tanstack-start-native",
    compilerVersion: "test",
    buildMode: "native",
    files,
    contentSnapshot: {
      publicationId: "pub",
      storefrontId: "store",
      themeId: "theme",
      documents: [
        {
          item: {
            id: "item",
            publicationId: "pub",
            itemType: "template",
            contentId: "page",
            revisionId: "revision",
            metadata: { routePath: "/landing" },
          },
          document: {
            version: 1,
            sections: [
              {
                id: "hero",
                type: "hero",
                enabled: true,
                props: { title: "sealed-title" },
              },
            ],
          },
        },
      ],
    },
  } as unknown as ThemeBuildRunnerInput;
  const routeRegistry = themeFramework().build.native.routeRegistry(files);

  /** What the prerender server records for a read it cannot answer. */
  const refusedRecord = (reason: string) =>
    new TextEncoder().encode(
      JSON.stringify({ path: "/landing", reason }) + "\n",
    );

  /** One pass that exited non-zero after the content server refused a read. */
  const failedPass = (reason: string): ThemeBuildRunnerResult =>
    nativeBuildResult({
      input,
      outputs: new Map([
        [NATIVE_PRERENDER_REFUSED_READS_PATH, refusedRecord(reason)],
      ]),
      routeRegistry,
      limits: { maxOutputFiles: 100, maxOutputSizeBytes: 1_000_000 },
      mimeType: () => "text/plain",
      isText: () => true,
      logs: [],
      addLog: () => {},
      startTime: Date.now(),
      buildFailure: {
        stage: "compiler",
        message:
          "NATIVE_BUILD_FAILED: Error: Failed to fetch /landing: Internal Server Error",
      },
    });

  it("is a prerender-content failure, the stage the build passes rebuild with sealed content", () => {
    const result = failedPass(
      "NATIVE_PRERENDER_NO_CONTENT_SNAPSHOT: this build has no sealed content",
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.diagnosticsJson?.stage).toBe("prerender-content");
    expect(result.errorMessage).toContain(
      "NATIVE_PRERENDER_CONTENT_UNAVAILABLE",
    );
    expect(result.errorMessage).toContain(
      "/landing (NATIVE_PRERENDER_NO_CONTENT_SNAPSHOT",
    );
  });

  it("is built again with the sealed content, and the sealed pass's own refusal still fails the build", async () => {
    const given: NativePrerenderContent[] = [];
    const pass = vi.fn(async (content: NativePrerenderContent) => {
      given.push(content);
      // The second pass is given sealed content, yet refuses: the build
      // must fail, never answer with defaults.
      return failedPass(
        content.refusedAll ?? "NATIVE_PRERENDER_PATH_NOT_SEALED: stand-in",
      );
    });

    const result = await runNativeBuildPasses({
      input,
      routeRegistry,
      addLog: () => {},
      pass,
    });

    // The sealed snapshot reached a prerender.
    expect(pass).toHaveBeenCalledTimes(2);
    expect(given[1]?.refusedAll).toBeUndefined();
    expect(given[1]?.content["/landing"]).toMatchObject({
      slots: { hero: { title: "sealed-title" } },
    });
    // A read failure is still fatal.
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.diagnosticsJson?.stage).toBe("prerender-content");
  });

  /** A pass whose build exited non-zero with this output, and maybe a record. */
  const exitedNonZero = (
    message: string,
    record?: Uint8Array,
  ): ThemeBuildRunnerResult =>
    nativeBuildResult({
      input,
      outputs: new Map(
        record ? [[NATIVE_PRERENDER_REFUSED_READS_PATH, record]] : [],
      ),
      routeRegistry,
      limits: { maxOutputFiles: 100, maxOutputSizeBytes: 1_000_000 },
      mimeType: () => "text/plain",
      isText: () => true,
      logs: [],
      addLog: () => {},
      startTime: Date.now(),
      buildFailure: { stage: "compiler", message },
    });
  const COMPILE_ERROR =
    'NATIVE_BUILD_FAILED: ✘ [ERROR] Expected ";" but found "}" src/routes/landing.tsx:3:1';

  it("contrast: a compile error with no refused read keeps its own stage and message and gets no sealed pass", async () => {
    const pass = vi.fn(async () => exitedNonZero(COMPILE_ERROR));

    const result = await runNativeBuildPasses({
      input,
      routeRegistry,
      addLog: () => {},
      pass,
    });

    // Stopped at the first pass: the sealed content never entered a build.
    expect(pass).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.diagnosticsJson?.stage).toBe("compiler");
    expect(result.errorMessage).toBe(COMPILE_ERROR);
    expect(result.errorMessage).not.toContain(
      "NATIVE_PRERENDER_CONTENT_UNAVAILABLE",
    );
  });

  it("contrast: a compile error after a refused first-pass read is retried sealed, and the sealed pass's own compile error is what the build reports", async () => {
    // The first pass both refused a read and failed to compile: it is read
    // as the content case. The sealed pass, which refuses nothing, fails on
    // the compile error alone, and that is the result's stage and message.
    const pass = vi.fn(async (content: NativePrerenderContent) =>
      content.refusedAll
        ? exitedNonZero(
            COMPILE_ERROR,
            refusedRecord("NATIVE_PRERENDER_NO_CONTENT_SNAPSHOT: stand-in"),
          )
        : exitedNonZero(COMPILE_ERROR),
    );

    const result = await runNativeBuildPasses({
      input,
      routeRegistry,
      addLog: () => {},
      pass,
    });

    expect(pass).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.diagnosticsJson?.stage).toBe("compiler");
    expect(result.errorMessage).toBe(COMPILE_ERROR);
  });
});
