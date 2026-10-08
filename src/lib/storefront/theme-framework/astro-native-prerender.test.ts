// @vitest-environment node
import { describe, expect, it } from "vitest";
import { answerSealedContentRead } from "../compiler/theme-prerender-content";
import { normalizeRoutePath } from "../theme-template-routes";
import {
  ASTRO_PRERENDER_SHIM_MARKER,
  astroArtifactLeaks,
  astroBuildIntegrationSource,
  astroPrerenderRecordsFailure,
  astroPrerenderWorkspaceFiles,
  astroRouteRegistry,
} from "./astro-native-prerender";

const NONCE = "a".repeat(32);
const ndjson = (...records: object[]) =>
  records.map((record) => `${JSON.stringify(record)}\n`).join("");

describe("Astro prerender content keys", () => {
  it("are Core's: one key with or without a trailing slash, never one for two paths", () => {
    expect(normalizeRoutePath("/about/")).toBe("/about");
    expect(normalizeRoutePath("/about")).toBe("/about");
    expect(normalizeRoutePath("/")).toBe("/");
    expect(normalizeRoutePath("")).toBe("/");
    const paths = [
      "/",
      "/about",
      "/abou",
      "/about/team",
      "/aboutteam",
      `/${encodeURIComponent("關於")}`,
      `/${encodeURIComponent("關於")}/team`,
      "/products/a",
      "/products/a-b",
      "/%2F",
    ];
    const keys = paths.map(normalizeRoutePath);
    expect(new Set(keys).size).toBe(paths.length);
  });

  it("come from src/pages file names, as URL paths", () => {
    const registry = astroRouteRegistry([
      { path: "src/pages/index.astro" },
      { path: "src/pages/about.astro" },
      { path: "src/pages/blog/index.md" },
      { path: "src/pages/blog/[slug].astro" },
      { path: "src/pages/docs/[...rest].astro" },
      { path: "src/pages/關於.astro" },
      { path: "src/pages/_draft.astro" },
      { path: "src/pages/_parts/card.astro" },
      { path: "src/pages/feed.xml.ts" },
      { path: "src/components/Hero.astro" },
      { path: "src/pages/notes.txt" },
    ]);
    expect(
      registry.routes.map((route) => [route.path, route.dynamic]),
    ).toEqual([
      ["/", false],
      ["/about", false],
      ["/blog", false],
      ["/blog/[slug]", true],
      ["/docs/[...rest]", true],
      [`/${encodeURIComponent("關於")}`, false],
      ["/feed.xml", false],
    ]);
  });
});

describe("Astro prerender workspace files", () => {
  it("are refused without a usable nonce", () => {
    expect(() =>
      astroPrerenderWorkspaceFiles({
        themeConfigPath: "astro.config.mjs",
        nonce: "short",
      }),
    ).toThrow("ASTRO_PRERENDER_NONCE_INVALID");
  });

  it("have every defence on unless a test switches one off", () => {
    const source = astroBuildIntegrationSource({ nonce: NONCE, testFaults: {} });
    expect(source).toContain("const FAIL_FAST = true;");
    expect(source).toContain("const CONTENT_SERVER_FAULT = null;");
    expect(source).toContain(
      'const ENTRY = "@astrojs/cloudflare/entrypoints/server";',
    );
    // Core's key and the shared answer, by their own source.
    expect(source).toContain(normalizeRoutePath.toString());
    expect(source).toContain(answerSealedContentRead.toString());
  });
});

describe("astroPrerenderRecordsFailure", () => {
  const done = { nonce: NONCE, done: true };
  const outputs = (files: Record<string, string>) =>
    new Map(Object.entries(files));

  it("passes a build whose every prerendered page has its stamp", () => {
    expect(
      astroPrerenderRecordsFailure(
        outputs({
          ".morph/prerender-pages.ndjson": ndjson(
            { nonce: NONCE, path: "/" },
            { nonce: NONCE, path: "/plain" },
            done,
          ),
          ".morph/prerender-stamped.ndjson": ndjson(
            { nonce: NONCE, path: "/", reads: 1, failures: 0 },
            { nonce: NONCE, path: "/plain", reads: 0, failures: 0 },
          ),
        }),
        NONCE,
      ),
    ).toBeNull();
  });

  it("passes a build that prerendered nothing, once it says it is done", () => {
    expect(
      astroPrerenderRecordsFailure(
        outputs({ ".morph/prerender-pages.ndjson": ndjson(done) }),
        NONCE,
      ),
    ).toBeNull();
  });

  it("refuses a torn record", () => {
    expect(
      astroPrerenderRecordsFailure(
        outputs({
          ".morph/prerender-pages.ndjson": ndjson(done),
          ".morph/prerender-refused-reads.ndjson": '{"nonce":',
        }),
        NONCE,
      )?.code,
    ).toBe("NATIVE_PRERENDER_RECORD_INVALID");
  });

  it("refuses a stamp that does not say how many reads failed", () => {
    expect(
      astroPrerenderRecordsFailure(
        outputs({
          ".morph/prerender-pages.ndjson": ndjson(
            { nonce: NONCE, path: "/" },
            done,
          ),
          ".morph/prerender-stamped.ndjson": ndjson({
            nonce: NONCE,
            path: "/",
            reads: 1,
          }),
        }),
        NONCE,
      )?.code,
    ).toBe("NATIVE_PRERENDER_CONTENT_READ_FAILED");
  });
});

describe("astroArtifactLeaks", () => {
  it("finds the wrapper, the prerender bundle and Morph's records in dist", () => {
    expect(
      astroArtifactLeaks(
        new Map([
          ["dist/server/entry.mjs", "export default {}"],
          ["dist/server/chunks/a.mjs", `const m = "${ASTRO_PRERENDER_SHIM_MARKER}";`],
          ["dist/server/.prerender/entry.mjs", ""],
          ["dist/client/.morph/prerender-stamped.ndjson", ""],
          [".morph/prerender-stamped.ndjson", ""],
        ]),
      ),
    ).toEqual([
      "dist/server/chunks/a.mjs (prerender wrapper)",
      "dist/server/.prerender/entry.mjs (prerender bundle)",
      "dist/client/.morph/prerender-stamped.ndjson (Morph record)",
    ]);
  });
});
