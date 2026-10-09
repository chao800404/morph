// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  collectNativeAstroArtifact,
  planNativeAstroBuild,
} from "./astro-native-build";
import { astroThemeFiles } from "./astro-native-prerender.fixtures";
import { planNativeStartBuild } from "./tanstack-start-native-build";

// docs/astro-theme-plan.md 5.2.4: a Wrangler config is optional for Astro;
// what the build produces is checked either way, and the tool directories
// never come from a Theme's source.

const withoutWrangler = () =>
  astroThemeFiles().filter((file) => file.path !== "wrangler.jsonc");

describe("an Astro plan's Wrangler config", () => {
  it("uses the project's own, through Morph's copy, when it has one", () => {
    const plan = planNativeAstroBuild(astroThemeFiles());
    if (!plan.ok) throw new Error(plan.message);
    expect(plan.env.CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH).toBe(
      ".morph/wrangler.json",
    );
    expect(plan.workspaceFiles.map((file) => file.path)).toContain(
      ".morph/wrangler.json",
    );
  });

  it("leaves the adapter's defaults when it has none", () => {
    const plan = planNativeAstroBuild(withoutWrangler());
    if (!plan.ok) throw new Error(plan.message);
    expect(plan.env).not.toHaveProperty("CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH");
    expect(plan.workspaceFiles.map((file) => file.path)).not.toContain(
      ".morph/wrangler.json",
    );
  });

  it("refuses a wrangler.toml before the build, with or without another config", () => {
    for (const files of [withoutWrangler(), astroThemeFiles()]) {
      const plan = planNativeAstroBuild([
        ...files,
        { path: "wrangler.toml", content: 'name = "x"\n' },
      ]);
      expect(plan).toMatchObject({ ok: false, code: "NATIVE_WRANGLER_CONFIG" });
    }
  });

  it("refuses a project config that declares a binding Morph cannot map, previews included", () => {
    for (const config of [
      '{ "name": "x", "d1_databases": [{ "binding": "DB" }] }',
      '{ "name": "x", "previews": { "r2_buckets": [{ "binding": "B" }] } }',
    ]) {
      const plan = planNativeAstroBuild([
        ...withoutWrangler(),
        { path: "wrangler.jsonc", content: config },
      ]);
      expect(plan).toMatchObject({ ok: false, code: "NATIVE_BINDINGS_UNMAPPED" });
    }
  });
});

describe("a native build's source", () => {
  const reserved = [
    ".wrangler/state/v3/kv/miniflare-KVNamespaceObject/data.sqlite",
    ".wrangler/deploy/config.json",
    ".morph/astro-build-integration.mjs",
    ".Wrangler/state/x",
  ];

  it("never supplies the build's tool or Morph directories (Astro)", () => {
    for (const path of reserved) {
      expect(
        planNativeAstroBuild([...astroThemeFiles(), { path, content: "x" }]),
      ).toMatchObject({ ok: false, code: "NATIVE_RESERVED_PATH" });
    }
  });

  it("never supplies them for Start either", () => {
    const start = [
      { path: "vite.config.ts", content: "export default {};" },
      {
        path: "wrangler.jsonc",
        content: '{ "name": "x", "main": "@tanstack/react-start/server-entry" }',
      },
    ];
    expect(planNativeStartBuild(start).ok).toBe(true);
    for (const path of reserved) {
      expect(
        planNativeStartBuild([...start, { path, content: "x" }]),
      ).toMatchObject({ ok: false, code: "NATIVE_RESERVED_PATH" });
    }
  });
});

const enc = (value: unknown) => JSON.stringify(value);
const built = (worker: Record<string, unknown>, extra: Record<string, string> = {}) =>
  new Map(
    Object.entries({
      ".wrangler/deploy/config.json": enc({ configPath: "../../dist/server/wrangler.json" }),
      "dist/server/wrangler.json": enc({
        main: "entry.mjs",
        assets: { binding: "ASSETS", directory: "../client" },
        ...worker,
      }),
      "dist/server/entry.mjs": "export default {}",
      "dist/client/index.html": "<h1>home</h1>",
      ".wrangler/state/v3/kv/data.sqlite": "state",
      ...extra,
    }),
  );

describe("the Worker config an Astro build wrote", () => {
  it("passes with the adapter's own defaults, and leaves the tool state out", () => {
    const artifact = collectNativeAstroArtifact(
      built({ compatibility_date: "2026-10-01", compatibility_flags: [], kv_namespaces: [] }),
    );
    expect([...artifact.files.keys()].some((path) => path.includes(".wrangler"))).toBe(false);
  });

  it("is refused when it declares a binding Morph cannot map, whoever wrote it", () => {
    for (const worker of [
      { d1_databases: [{ binding: "DB" }] },
      { previews: { queues: { producers: [{ binding: "Q" }] } } },
    ]) {
      expect(() => collectNativeAstroArtifact(built(worker))).toThrow(
        /^NATIVE_BINDINGS_UNMAPPED: /,
      );
    }
  });

  it("is refused when the tool state lands inside the Worker's directory", () => {
    expect(() =>
      collectNativeAstroArtifact(
        built({}, { "dist/server/.wrangler/state/v3/kv/data.sqlite": "state" }),
      ),
    ).toThrow(/^NATIVE_ARTIFACT_TOOL_STATE: /);
  });
});
