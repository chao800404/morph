// @vitest-environment node
import { describe, expect, it } from "vitest";
import type {
  StorefrontThemeBuildDTO,
  StorefrontThemeBuildInput,
} from "../dto/storefront-theme-build.dto";
import type { StorefrontThemeRevisionDTO } from "../dto/storefront-theme-file.dto";
import { ThemeFrameworkUnavailableError } from "../theme-framework";
import { nativeBuildResult } from "./native-build-result";
import { materializeThemeBuildInput } from "./theme-build-materializer";
import { computeThemeInputHash } from "./theme-compiler-hasher";

// docs/astro-theme-plan.md, A1: the build input records its framework, the
// framework is part of inputHash, and a recorded framework Morph cannot build
// is refused, never built as TanStack Start.

const revision = {
  id: "rev-1",
  storefrontId: "storefront-1",
  themeId: "theme-1",
  revisionNumber: 1,
  snapshot: [
    {
      path: "src/index.tsx",
      content: "export default () => <h1>Home</h1>;",
      isEntry: true,
    },
  ],
} as unknown as StorefrontThemeRevisionDTO;

const build = (
  overrides: Partial<StorefrontThemeBuildDTO> = {},
): StorefrontThemeBuildDTO =>
  ({
    id: "build-1",
    storefrontId: "storefront-1",
    themeId: "theme-1",
    sourceRevisionId: "rev-1",
    status: "queued",
    inputHash: null,
    compilerId: null,
    compilerVersion: null,
    contentPublicationId: null,
    ...overrides,
  }) as StorefrontThemeBuildDTO;

/** The hash exactly as it was computed before the framework was recorded. */
function hashWithoutFramework(input: StorefrontThemeBuildInput): string {
  return computeThemeInputHash(
    { files: input.files, binaryFiles: input.binaryFiles, entry: input.entry },
    { id: input.compilerId, version: input.compilerVersion },
  );
}

describe("the framework in a build's input", () => {
  it("is recorded in the input, as TanStack Start when the build names none", () => {
    expect(
      materializeThemeBuildInput({ build: build(), revision }).framework,
    ).toBe("tanstack-start");
    expect(
      materializeThemeBuildInput({
        build: build({ framework: "tanstack-start" }),
        revision,
      }).framework,
    ).toBe("tanstack-start");
  });

  it("changes inputHash when it changes", () => {
    const start = materializeThemeBuildInput({ build: build(), revision });
    const identity = { id: start.compilerId, version: start.compilerVersion };
    const asAstro = computeThemeInputHash(
      { ...start, framework: "astro" },
      identity,
    );

    expect(asAstro).not.toBe(start.inputHash);
    expect(
      computeThemeInputHash(
        { ...start, framework: "tanstack-start" },
        identity,
      ),
    ).toBe(start.inputHash);
  });

  it("leaves the inputHash of every Start build exactly as it was", () => {
    // A recorded inputHash is checked again on every materialization; one
    // computed before frameworks were recorded must keep matching.
    const unrecorded = materializeThemeBuildInput({ build: build(), revision });
    const recordedStart = materializeThemeBuildInput({
      build: build({ framework: "tanstack-start" }),
      revision,
    });
    expect(unrecorded.inputHash).toBe(hashWithoutFramework(unrecorded));
    expect(recordedStart.inputHash).toBe(unrecorded.inputHash);

    const started = build({
      status: "building",
      framework: null,
      inputHash: hashWithoutFramework(unrecorded),
      compilerId: unrecorded.compilerId,
      compilerVersion: unrecorded.compilerVersion,
    });
    expect(() =>
      materializeThemeBuildInput({ build: started, revision }),
    ).not.toThrow();
  });

  it("refuses a build recorded for a framework Morph cannot build yet", () => {
    let refusal: unknown;
    try {
      materializeThemeBuildInput({
        build: build({ framework: "astro" }),
        revision,
      });
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(ThemeFrameworkUnavailableError);
    expect(refusal).toMatchObject({
      code: "THEME_FRAMEWORK_UNAVAILABLE",
      framework: "astro",
    });
    expect((refusal as Error).message).toMatch(
      /^THEME_FRAMEWORK_UNAVAILABLE: /,
    );
  });

  it("refuses a build recorded with a value that is no framework at all", () => {
    for (const recorded of ["react-router", ""]) {
      expect(() =>
        materializeThemeBuildInput({
          build: build({ framework: recorded }),
          revision,
        }),
      ).toThrow(/^THEME_FRAMEWORK_UNKNOWN: /);
    }
  });

  it("is refused before the files are looked at", () => {
    // An empty snapshot would otherwise be the error; the framework comes first.
    expect(() =>
      materializeThemeBuildInput({
        build: build({ framework: "astro" }),
        revision: { ...revision, snapshot: [] } as StorefrontThemeRevisionDTO,
      }),
    ).toThrow(/^THEME_FRAMEWORK_UNAVAILABLE: /);
  });
});

describe("a native build's result, by the framework the input records", () => {
  it("is refused for a framework without an adapter, before any output is read", () => {
    const logs: never[] = [];
    const result = nativeBuildResult({
      input: {
        buildId: "build-1",
        storefrontId: "storefront-1",
        themeId: "theme-1",
        sourceRevisionId: "rev-1",
        revisionNumber: 1,
        entry: "src/index.tsx",
        inputHash: "hash",
        compilerId: "tanstack-start-native",
        compilerVersion: "1",
        files: [],
        framework: "astro",
      },
      outputs: new Map(),
      routeRegistry: null,
      limits: { maxOutputFiles: 10, maxOutputSizeBytes: 10 },
      mimeType: () => "text/plain",
      isText: () => true,
      logs,
      addLog: () => {},
      startTime: Date.now(),
    });
    if (result.success) throw new Error("expected the build to be refused");
    expect(result.errorMessage).toMatch(/^THEME_FRAMEWORK_UNAVAILABLE: /);
    expect(result.diagnosticsJson).toMatchObject({ stage: "framework" });
  });
});
