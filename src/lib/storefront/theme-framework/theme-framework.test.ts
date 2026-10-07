// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { STARTER_THEME_FILES } from "../starter-theme-files";
import { THEME_PREVIEW_SERVER_BASE_PATH } from "../compiler/theme-preview-dev-server";
import { buildThemeRouteRegistry } from "../compiler/theme-route-registry";
import { THEME_FRAMEWORKS, themeFramework } from ".";
import { tanstackStartFramework } from "./tanstack-start.framework";

const here = path.dirname(new URL(import.meta.url).pathname);

describe("the framework adapter boundary", () => {
  // docs/multi-runtime-theme-plan.md, step 2: an adapter owns preview, build,
  // routes and artifacts — never auth, OCC, documents, publish or rollback.
  it("has only framework concerns on it", () => {
    for (const framework of THEME_FRAMEWORKS) {
      expect(Object.keys(framework).sort()).toEqual(
        ["build", "detect", "id", "planWorkspace", "preview"].sort(),
      );
      expect(Object.keys(framework.preview)).toEqual(["framePath"]);
      expect(Object.keys(framework.build).sort()).toEqual(
        [
          "artifactEntry",
          "manifestMetadata",
          "native",
          "verifyArtifact",
        ].sort(),
      );
      expect(Object.keys(framework.build.native).sort()).toEqual(
        [
          "artifactEntry",
          "collect",
          "manifestMetadata",
          "plan",
          "verifyArtifact",
        ].sort(),
      );
    }
  });

  it("does not reach into the shared core", () => {
    const sharedCore =
      /from ["'][^"']*(\/dal\/|\/auth|\/server\/|\/storage\/|release|publish|revision-store|preview-write-fence|\/db["'/])/;
    const layers = [here, path.join(here, "..", "source-language")];
    for (const dir of layers) {
      for (const file of readdirSync(dir).filter(
        (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
      )) {
        const source = readFileSync(path.join(dir, file), "utf8");
        expect(source, `${file} imports the shared core`).not.toMatch(
          sharedCore,
        );
      }
    }
  });

  it("serves every Theme through TanStack Start today", () => {
    expect(themeFramework()).toBe(tanstackStartFramework);
  });
});

describe("TanStack Start", () => {
  const framework = tanstackStartFramework;
  const registry = buildThemeRouteRegistry(STARTER_THEME_FILES);

  it("recognises a Start project and not a single-entry Theme", () => {
    expect(framework.detect(STARTER_THEME_FILES)).toBe(true);
    expect(
      framework.detect([
        { path: "src/routes/index.tsx", content: "export default () => null;" },
      ]),
    ).toBe(false);
  });

  it("frames a Start preview at the root and the browser preview under the base path", () => {
    expect(framework.preview.framePath("start")).toBe("/");
    expect(framework.preview.framePath("client")).toBe(
      THEME_PREVIEW_SERVER_BASE_PATH,
    );
    expect(framework.preview.framePath(undefined)).toBe(
      THEME_PREVIEW_SERVER_BASE_PATH,
    );
  });

  it("describes a routed artifact exactly as the runners did", () => {
    expect(framework.build.artifactEntry(registry)).toBe("preview/index.html");
    expect(framework.build.artifactEntry(null)).toBe("index.html");
    expect(framework.build.manifestMetadata(registry)).toEqual({
      router: "tanstack-start",
      runtime: "cloudflare-worker",
      workerEntry: "runtime/server/index.js",
      clientAssetsDirectory: "runtime/client",
      previewRuntime: "tanstack-router-client",
      previewEntry: "preview/index.html",
      routes: registry.routes,
    });
    expect(framework.build.manifestMetadata(null)).toBeUndefined();
  });

  describe("verifyArtifact", () => {
    const complete = new Set([
      "runtime/server/index.js",
      "preview/index.html",
      "runtime/client/assets/app.js",
    ]);
    const verify = (paths: ReadonlySet<string>, routed = true) =>
      framework.build.verifyArtifact({
        artifactPaths: paths,
        routeRegistry: routed ? registry : null,
        contentSnapshot: undefined,
      });
    const without = (missing: string) =>
      new Set([...complete].filter((p) => p !== missing));

    it("accepts a complete Start artifact", () => {
      expect(() => verify(complete)).not.toThrow();
    });

    it("refuses each missing part with the message the runners used", () => {
      expect(() => verify(without("runtime/server/index.js"))).toThrow(
        "INCOMPLETE_START_ARTIFACT: TanStack Start build did not produce runtime/server/index.js.",
      );
      expect(() => verify(without("preview/index.html"))).toThrow(
        "INCOMPLETE_START_ARTIFACT: TanStack Start build did not produce preview/index.html.",
      );
      expect(() => verify(without("runtime/client/assets/app.js"))).toThrow(
        "INCOMPLETE_START_ARTIFACT: TanStack Start build did not produce runtime client assets.",
      );
    });

    it("checks nothing for a Theme without routes", () => {
      expect(() => verify(new Set(), false)).not.toThrow();
    });
  });
});
