// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseJsonc } from "./jsonc";
import {
  NATIVE_DEPLOY_CONFIG_PATH,
  NATIVE_WRANGLER_CONFIG_PATH,
  collectNativeStartArtifact,
  planNativeStartBuild,
} from "./tanstack-start-native-build";
import {
  NATIVE_ADAPTER_REFUSAL_PATH,
  NATIVE_BUILD_HOOKS_PATH,
  NATIVE_BUILD_LOADER_PATH,
  NATIVE_BUILD_NODE_OPTIONS,
  NATIVE_WRAPPER_CONFIG_PATH,
  nativeImportGuardPluginSource,
  nativeWrapperConfigSource,
} from "./tanstack-start-native-wrapper";
import {
  NATIVE_PROOF_VERSION,
  NATIVE_RESOLUTION_PLUGIN_PATH,
  nativeResolutionPluginSource,
  nativeSdkSentinel,
} from "./native-start-proof";
import { nativeStartProofRecordsForTest } from "./native-start-proof.test-support";

describe("parseJsonc", () => {
  it("reads comments and trailing commas the way Wrangler accepts them", () => {
    expect(
      parseJsonc(`{
  // the Worker's name
  "name": "shop", /* inline */
  "compatibility_flags": ["nodejs_compat",],
  "vars": { "URL": "https://example.com//path", "Q": "a\\"//b", },
}`),
    ).toEqual({
      name: "shop",
      compatibility_flags: ["nodejs_compat"],
      vars: { URL: "https://example.com//path", Q: 'a"//b' },
    });
  });

  it("still rejects what is not JSON", () => {
    expect(() => parseJsonc("{ name: shop }")).toThrow();
  });
});

const VITE_CONFIG = `import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
export default defineConfig({ plugins: [cloudflare({ viteEnvironment: { name: "ssr" } }), tanstackStart()] });
`;
const WRANGLER = `{
  // as written by the author
  "name": "shop",
  "compatibility_date": "2025-09-02",
  "compatibility_flags": ["nodejs_compat"],
  "main": "@tanstack/react-start/server-entry",
}`;
const COMPONENT = `export default function Hero() { return <h1 data-morph-node="hero">Hi</h1>; }\n`;

const project = (overrides: Record<string, string | undefined> = {}) =>
  Object.entries({
    "vite.config.ts": VITE_CONFIG,
    "wrangler.jsonc": WRANGLER,
    "src/components/Hero.tsx": COMPONENT,
    ...overrides,
  })
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([path, content]) => ({ path, content }));

describe("planNativeStartBuild", () => {
  it("keeps the project's own config and points the Cloudflare plugin at Morph's copy", () => {
    const plan = planNativeStartBuild(project());
    if (!plan.ok) throw new Error(plan.message);
    const byPath = new Map(plan.workspaceFiles.map((f) => [f.path, f.content]));
    // Used as written: never rewritten. Morph's plugins live in its wrapper,
    // which imports the project's config.
    expect(byPath.get("vite.config.ts")).toBe(VITE_CONFIG);
    const wrapper = byPath.get(NATIVE_WRAPPER_CONFIG_PATH)!;
    expect(wrapper).toContain('import themeConfig from "../vite.config.ts";');
    expect(wrapper).toContain("morph:native-import-guard");
    // Start's prerender fetches its preview server; in the build image
    // "localhost" binds IPv6 only, so the server gets one address.
    expect(wrapper).toContain('preview: { host: "127.0.0.1" }');
    // No content snapshot: the content plugin is there all the same, and
    // refuses — and records — every read, so a prerendered page cannot
    // quietly fall back to component defaults.
    expect(wrapper).toContain("morph:frozen-prerender-content");
    expect(wrapper).toContain(".morph/prerender-refused-reads.ndjson");
    expect(
      JSON.parse(byPath.get(".morph-prerender-content.json")!),
    ).toMatchObject({
      content: {},
      refusedAll: expect.stringContaining(
        "NATIVE_PRERENDER_NO_CONTENT_SNAPSHOT",
      ),
    });
    expect(byPath.get("wrangler.jsonc")).toBe(WRANGLER);
    expect(JSON.parse(byPath.get(NATIVE_WRANGLER_CONFIG_PATH)!)).toEqual({
      name: "shop",
      compatibility_date: "2025-09-02",
      compatibility_flags: ["nodejs_compat"],
      main: "@tanstack/react-start/server-entry",
    });
    // The build's Node process loads Morph's module hook first: the plugin's
    // debugger port goes off without the project's config being rewritten.
    expect(plan.env).toEqual({
      CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH: NATIVE_WRANGLER_CONFIG_PATH,
      NODE_OPTIONS: NATIVE_BUILD_NODE_OPTIONS,
    });
    expect(byPath.get(NATIVE_BUILD_HOOKS_PATH)).toContain("register(");
    expect(byPath.get(NATIVE_BUILD_LOADER_PATH)).toContain(
      "inspectorPort: false",
    );
    expect(plan.command).toEqual([
      "vite",
      "build",
      "--config",
      NATIVE_WRAPPER_CONFIG_PATH,
    ]);
  });

  it("writes the build's sealed content for the prerender to read", () => {
    const sealed = {
      content: {
        "/": { slots: { hero: { title: "Sealed" } }, hiddenSlots: [] },
      },
      unavailable: { "/blog": "SSG_CONTENT_TEMPLATE_IDENTITY_REQUIRED" },
    };
    const plan = planNativeStartBuild(project(), { prerenderContent: sealed });
    if (!plan.ok) throw new Error(plan.message);
    const byPath = new Map(plan.workspaceFiles.map((f) => [f.path, f.content]));
    expect(byPath.get(NATIVE_WRAPPER_CONFIG_PATH)).toContain(
      "morph:frozen-prerender-content",
    );
    expect(JSON.parse(byPath.get(".morph-prerender-content.json")!)).toEqual(
      sealed,
    );
  });

  it("replaces the sealed content file the project keeps at Morph's path", () => {
    const plan = planNativeStartBuild(
      project({ ".morph-prerender-content.json": '{"forged":true}' }),
    );
    if (!plan.ok) throw new Error(plan.message);
    const byPath = new Map(plan.workspaceFiles.map((f) => [f.path, f.content]));
    expect(byPath.get(NATIVE_WRAPPER_CONFIG_PATH)).toContain(
      "morph:native-import-guard",
    );
    expect(byPath.get(NATIVE_BUILD_HOOKS_PATH)).toBeDefined();
    expect(byPath.get(NATIVE_BUILD_LOADER_PATH)).toBeDefined();
    expect(byPath.get(".morph-prerender-content.json")).not.toContain("forged");
  });

  it("carries Morph's SDK copy and aliases @morph/sdk and @morph/sdk/start to it", () => {
    const plan = planNativeStartBuild(project());
    if (!plan.ok) throw new Error(plan.message);
    const byPath = new Map(plan.workspaceFiles.map((f) => [f.path, f.content]));
    expect(byPath.get(".morph/sdk/start/index.ts")).toContain(
      "x-morph-content-origin",
    );
    expect(byPath.has(".morph/sdk/src/client.ts")).toBe(true);
    const wrapper = byPath.get(NATIVE_WRAPPER_CONFIG_PATH)!;
    expect(wrapper).toContain(
      'path.join(workspaceRoot, ".morph/sdk/start/index.ts")',
    );
    expect(wrapper).toContain(
      'path.join(workspaceRoot, ".morph/sdk/src/index.ts")',
    );
  });

  it("refuses a project that carries files in Morph's or the tools' own directories", () => {
    // Replacing only the files Morph writes would leave the rest in place —
    // a pre-seeded record, Miniflare state a prerender would read — so the
    // directories are refused whole (docs/astro-theme-plan.md 5.2.4).
    for (const path of [
      ".morph/sdk/start/index.ts",
      ".morph/vite.config.ts",
      ".morph/prerender-refused-reads.ndjson",
      ".morph/native-build-hooks.mjs",
      ".wrangler/state/v3/kv/data.sqlite",
    ]) {
      expect(
        planNativeStartBuild(project({ [path]: "the project's own" })),
      ).toMatchObject({ ok: false, code: "NATIVE_RESERVED_PATH" });
    }
  });

  it("removes editor markers from the built source, as Morph's own builds do", () => {
    const plan = planNativeStartBuild(project());
    if (!plan.ok) throw new Error(plan.message);
    const hero = plan.workspaceFiles.find(
      (f) => f.path === "src/components/Hero.tsx",
    )!.content;
    expect(hero).not.toContain("data-morph-node");
  });

  it.each([
    ["no Vite config", { "vite.config.ts": undefined }, "NATIVE_VITE_CONFIG"],
    [
      "two Vite configs",
      { "vite.config.js": VITE_CONFIG },
      "NATIVE_VITE_CONFIG",
    ],
    [
      "no Wrangler config",
      { "wrangler.jsonc": undefined },
      "NATIVE_WRANGLER_CONFIG",
    ],
    [
      "both Wrangler configs",
      { "wrangler.json": "{}" },
      "NATIVE_WRANGLER_CONFIG",
    ],
    [
      "an unreadable Wrangler config",
      { "wrangler.jsonc": "{ name: x" },
      "NATIVE_WRANGLER_CONFIG",
    ],
    [
      "a binding Morph cannot map yet",
      {
        "wrangler.jsonc": WRANGLER.replace(
          '"name": "shop",',
          '"name": "shop", "d1_databases": [{ "binding": "DB" }],',
        ),
      },
      "NATIVE_BINDINGS_UNMAPPED",
    ],
    [
      "a Wrangler setting the contract refuses",
      {
        "wrangler.jsonc": WRANGLER.replace(
          '"name": "shop",',
          '"name": "shop", "placement": { "mode": "smart" },',
        ),
      },
      "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
    ],
    [
      "a Wrangler setting the contract does not know",
      {
        "wrangler.jsonc": WRANGLER.replace(
          '"name": "shop",',
          '"name": "shop", "some_future_key": {},',
        ),
      },
      "NATIVE_WRANGLER_SETTING_UNKNOWN",
    ],
    ["a wrangler.toml beside the .jsonc", { "wrangler.toml": 'name = "x"' }, "NATIVE_WRANGLER_CONFIG"],
    [".dev.vars", { ".dev.vars": "SECRET=1" }, "NATIVE_SECRET_UNMAPPED"],
    [".env", { ".env": "VITE_KEY=1" }, "NATIVE_SECRET_UNMAPPED"],
    [".env.production", { ".env.production": "VITE_KEY=1" }, "NATIVE_SECRET_UNMAPPED"],
  ])("refuses %s", (_label, overrides, code) => {
    const plan = planNativeStartBuild(project(overrides));
    expect(plan).toMatchObject({ ok: false, code });
  });

  it("leaves the Cloudflare plugin's options to the check at the call, not the config's text", () => {
    // PR 1 refused `configPath` and `remoteBindings` by reading the text;
    // the loader shim now checks the options the plugin is actually given
    // (native-build-hooks.test.ts, native-start-build.test.ts).
    for (const option of ['configPath: "./other.jsonc"', "remoteBindings: true"]) {
      const plan = planNativeStartBuild(
        project({
          "vite.config.ts": VITE_CONFIG.replace(
            'name: "ssr" }',
            `name: "ssr" }, ${option}`,
          ),
        }),
        { nonce: NONCE },
      );
      if (!plan.ok) throw new Error(plan.message);
      const loader = plan.workspaceFiles.find(
        (file) => file.path === NATIVE_BUILD_LOADER_PATH,
      )!.content;
      expect(loader).toContain("morphCheckCloudflareOptions(options);");
      expect(loader).toContain('\\"vite.config.ts\\"');
    }
  });

  it("carries the resolution plugin and this pass's nonce, and sentinels in the SDK copy", () => {
    const plan = planNativeStartBuild(project(), { nonce: NONCE });
    if (!plan.ok) throw new Error(plan.message);
    const byPath = new Map(plan.workspaceFiles.map((f) => [f.path, f.content]));
    expect(byPath.get(NATIVE_RESOLUTION_PLUGIN_PATH)).toBe(
      nativeResolutionPluginSource(),
    );
    const wrapper = byPath.get(NATIVE_WRAPPER_CONFIG_PATH)!;
    expect(wrapper).toContain('import morphNativeResolution from "./native-resolution.mjs";');
    expect(wrapper).toContain(`const morphBuildNonce = ${JSON.stringify(NONCE)};`);
    expect(wrapper).toContain(
      "morphNativeResolution({ workspaceRoot, nonce: morphBuildNonce })",
    );
    expect(byPath.get(".morph/sdk/start/index.ts")).toContain(
      nativeSdkSentinel(NONCE, "@morph/sdk/start"),
    );
    expect(byPath.get(".morph/sdk/src/index.ts")).toContain(
      nativeSdkSentinel(NONCE, "@morph/sdk"),
    );
  });

  it("holds Web Worker bundles to the import guard and records them, after the project's own worker plugins", () => {
    const plan = planNativeStartBuild(project(), { nonce: NONCE });
    if (!plan.ok) throw new Error(plan.message);
    const wrapper = plan.workspaceFiles.find(
      (f) => f.path === NATIVE_WRAPPER_CONFIG_PATH,
    )!.content;
    const workerBlock = wrapper.slice(wrapper.indexOf("merged.worker = {"));
    // The same guard the main graphs get, not a copy of a weaker one.
    expect(workerBlock).toContain(nativeImportGuardPluginSource());
    expect(workerBlock).toContain(
      'morphNativeResolution({ workspaceRoot, nonce: morphBuildNonce, scope: "worker" })',
    );
    // The project's own worker plugins first; the prerender content plugin
    // has nothing to answer in a browser-only bundle.
    expect(workerBlock.indexOf("ownWorkerPlugins()")).toBeLessThan(
      workerBlock.indexOf('name: "morph:native-import-guard"'),
    );
    expect(workerBlock).not.toContain("morph:frozen-prerender-content");
    expect(wrapper).toContain("morph:frozen-prerender-content");
    // Without the proof (no nonce), the wrapper is the one before it.
    const legacy = nativeWrapperConfigSource({
      themeConfigPath: "vite.config.ts",
      allowedPackages: [],
    });
    expect(legacy).not.toContain("merged.worker");
  });

  it("gives the build a copy without dev or the author's other ignored keys", () => {
    const plan = planNativeStartBuild(
      project({
        "wrangler.jsonc": WRANGLER.replace(
          '"name": "shop",',
          '"name": "shop", "$schema": "node_modules/wrangler/config-schema.json", "dev": { "port": 9999 }, "vars": { "STORE_LABEL": "probe" }, "observability": { "enabled": true },',
        ),
      }),
    );
    if (!plan.ok) throw new Error(plan.message);
    const copy = JSON.parse(
      plan.workspaceFiles.find((f) => f.path === NATIVE_WRANGLER_CONFIG_PATH)!
        .content,
    );
    expect(copy).toEqual({
      name: "shop",
      vars: { STORE_LABEL: "probe" },
      observability: { enabled: true },
      compatibility_date: "2025-09-02",
      compatibility_flags: ["nodejs_compat"],
      main: "@tanstack/react-start/server-entry",
    });
    // The author's file itself is in the workspace as written; the plugin
    // never reads it (CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH names the copy).
    expect(
      plan.workspaceFiles.find((f) => f.path === "wrangler.jsonc")!.content,
    ).toContain('"dev": { "port": 9999 }');
  });
});

// The layout an official Start Cloudflare build writes (measured on
// fixtures/tanstack/start-basic-cloudflare and on the starter built natively).
const officialOutputs = (
  overrides: Record<string, string | undefined> = {},
): Map<string, string> => {
  const built = Object.fromEntries(
    Object.entries(officialBuild(overrides)).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  // Morph's plugins' records, for a build importing no SDK, over the files
  // as written; an override can still remove or replace one.
  const records = nativeStartProofRecordsForTest(
    `const morphBuildNonce = ${JSON.stringify(NONCE)};`,
    built,
  );
  return new Map(
    Object.entries({ ...records, ...officialBuild(overrides) }).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
};

const officialBuild = (
  overrides: Record<string, string | undefined>,
): Record<string, string | undefined> => ({
      [NATIVE_DEPLOY_CONFIG_PATH]: JSON.stringify({
        configPath: "../../dist/server/wrangler.json",
        auxiliaryWorkers: [],
      }),
      // The pinned plugin always writes the author's compatibility date.
      "dist/server/wrangler.json": JSON.stringify({
        name: "shop",
        main: "index.js",
        compatibility_date: "2025-09-02",
        assets: { directory: "../client" },
        no_bundle: true,
      }),
      "dist/server/index.js":
        "export { default } from './assets/worker-entry.js';",
      "dist/server/assets/worker-entry.js": "export default {};",
      "dist/server/.vite/manifest.json": "{}",
      "dist/client/assets/index.js": "console.log(1)",
      "dist/client/favicon.ico": "ico",
      "src/routes/index.tsx": "source, not output",
      ...overrides,
});

/** The pass's nonce the records above were written under. */
const NONCE = "5f".repeat(16);
const collect = (outputs: ReadonlyMap<string, string>) =>
  collectNativeStartArtifact(outputs, NONCE);

describe("collectNativeStartArtifact: the proof", () => {
  it("attaches the verified SDK proof and the artifact's static HTML as manifest metadata", () => {
    const artifact = collect(
      officialOutputs({
        "dist/client/about/index.html": "<html>",
        "public/robots.html": "<html>",
        "dist/client/robots.html": "<html>",
      }),
    );
    expect(artifact.metadata).toEqual({
      nativeProof: {
        version: NATIVE_PROOF_VERSION,
        sdk: {
          environments: [
            { name: "client", output: "client", specifiers: [], edges: 0, sentinelFiles: [] },
            { name: "ssr", output: "server", specifiers: [], edges: 0, sentinelFiles: [] },
          ],
        },
        toolchain: { vite: "7.3.5" },
        html: [
          { path: "runtime/client/about/index.html", source: "prerender" },
          { path: "runtime/client/robots.html", source: "public" },
        ],
      },
    });
    expect(artifact.sourceDirectories).toEqual({
      server: "dist/server",
      client: "dist/client",
    });
  });

  it("refuses the artifact without the pass's nonce, or without the records", () => {
    expect(() => collectNativeStartArtifact(officialOutputs())).toThrow(
      "NATIVE_PROOF_SDK_RESOLUTION: this build pass has no nonce",
    );
    expect(() =>
      collect(
        officialOutputs({ ".morph/records/resolution.client.json": undefined }),
      ),
    ).toThrow(
      "NATIVE_PROOF_SDK_RESOLUTION: the build wrote no SDK resolution record for its browser output",
    );
  });

  it("refuses an artifact built after the adapter check refused an option, even if the config caught it", () => {
    const message =
      'NATIVE_ADAPTER_OPTION: vite.config.ts passes configPath to cloudflare(). Morph supplies the Wrangler config the plugin reads, from wrangler.jsonc at the project root; a config path would replace it. Remove "configPath"; keep wrangler.jsonc at the project root.';
    expect(() =>
      collect(
        officialOutputs({
          [NATIVE_ADAPTER_REFUSAL_PATH]: JSON.stringify({
            code: "NATIVE_ADAPTER_OPTION",
            message,
          }),
        }),
      ),
    ).toThrow(message);
  });
});

describe("collectNativeStartArtifact", () => {
  it("moves the Worker and its assets into Morph's artifact layout", () => {
    const artifact = collect(officialOutputs());
    expect([...artifact.files.keys()].sort()).toEqual([
      "runtime/client/assets/index.js",
      "runtime/client/favicon.ico",
      "runtime/server/.vite/manifest.json",
      "runtime/server/assets/worker-entry.js",
      "runtime/server/index.js",
      "runtime/server/wrangler.json",
    ]);
    expect(artifact.workerEntry).toBe("runtime/server/index.js");
    expect(artifact.clientAssetsDirectory).toBe("runtime/client");
    expect(
      JSON.parse(artifact.files.get("runtime/server/wrangler.json") as string),
    ).toMatchObject({ main: "index.js", assets: { directory: "../client" } });
  });

  it.each([
    ["no deploy config", { [NATIVE_DEPLOY_CONFIG_PATH]: undefined }],
    [
      "a deploy config naming a missing Worker config",
      { "dist/server/wrangler.json": undefined },
    ],
    [
      "a Worker entry the build did not write",
      { "dist/server/index.js": undefined },
    ],
    [
      "a Worker config without a separate assets directory",
      {
        "dist/server/wrangler.json": JSON.stringify({ main: "index.js" }),
      },
    ],
    [
      "no static assets",
      {
        "dist/client/assets/index.js": undefined,
        "dist/client/favicon.ico": undefined,
      },
    ],
    [
      "an entry outside the Worker directory",
      {
        "dist/server/wrangler.json": JSON.stringify({
          main: "../../src/routes/index.tsx",
          assets: { directory: "../client" },
        }),
      },
    ],
  ])("refuses %s", (_label, overrides) => {
    expect(() =>
      collect(officialOutputs(overrides)),
    ).toThrow("NATIVE_ARTIFACT_INCOMPLETE");
  });

  it.each([
    ["a binding the plugin wrote", { ai: { binding: "AI" } }, "NATIVE_BINDINGS_UNMAPPED"],
    ["a route", { routes: ["shop.example.com/*"] }, "NATIVE_ROUTE_CLAIM"],
    ["a setting the contract does not know", { future: true }, "NATIVE_WRANGLER_SETTING_UNKNOWN"],
    ["a reserved variable name", { vars: { MORPH_X: "1" } }, "NATIVE_BINDING_NAME_CLASH"],
    ["no compatibility date", { compatibility_date: undefined }, "NATIVE_WRANGLER_CONFIG"],
  ])("refuses a Worker config carrying %s, in the emitted shape", (_label, extra, code) => {
    const outputs = officialOutputs({
      "dist/server/wrangler.json": JSON.stringify({
        name: "shop",
        main: "index.js",
        compatibility_date: "2025-09-02",
        assets: { directory: "../client" },
        no_bundle: true,
        ...extra,
      }),
    });
    expect(() => collect(outputs)).toThrow(
      new RegExp(`^${code}: runtime/server/wrangler\\.json`),
    );
  });

  it("refuses a local variables file the build wrote beside the Worker", () => {
    expect(() =>
      collect(
        officialOutputs({ "dist/server/.dev.vars": "SECRET=1" }),
      ),
    ).toThrow("NATIVE_SECRET_UNMAPPED");
  });
});
