// @vitest-environment node
import { describe, expect, it } from "vitest";
import emittedFixtures from "../service/__fixtures__/theme-worker-emitted-configs.json";
import {
  NATIVE_EMITTED_WORKER_CONFIG_LABEL,
  NATIVE_WRANGLER_CONFIG_PATH,
  checkNativeWranglerConfig,
  planNativeWranglerConfig,
  refuseNativeProjectFiles,
} from "./cloudflare-native-build";
import { parseJsonc } from "./jsonc";

/**
 * The Wrangler key contract (render plan v2 step 1, design section 2): every
 * row of the key table, read in both shapes — the author's `wrangler.jsonc`
 * and the Worker config the pinned Cloudflare plugin wrote.
 */

/** The guide's config, as an author writes it. */
const AUTHOR_BASE = {
  $schema: "node_modules/wrangler/config-schema.json",
  name: "shop",
  compatibility_date: "2025-09-02",
  compatibility_flags: ["nodejs_compat"],
  main: "@tanstack/react-start/server-entry",
  observability: { enabled: true },
};

/**
 * What the pinned plugin wrote for that config plus two variables: a real
 * native Start build of 2026-11-27 (service/__fixtures__/
 * theme-worker-emitted-configs.json, `start-native-guide`).
 */
const EMITTED_BASE = JSON.parse(
  emittedFixtures["start-native-guide"].config,
) as Record<string, unknown>;

const author = (config: Record<string, unknown>) =>
  checkNativeWranglerConfig(config, {
    shape: "author",
    file: "wrangler.jsonc",
  });
const emitted = (config: Record<string, unknown>) =>
  checkNativeWranglerConfig(config, {
    shape: "emitted",
    file: NATIVE_EMITTED_WORKER_CONFIG_LABEL,
  });

type Expect = "ok" | string;

/**
 * Each row: a key, a value, what the author shape does with it and what the
 * emitted shape does with it (`ok`, or the refusal's code).
 */
const ROWS: Array<[string, unknown, Expect, Expect]> = [
  // keep
  ["main", "src/server.ts", "ok", "ok"],
  [
    "compatibility_flags",
    ["nodejs_compat", "global_fetch_strictly_public"],
    "ok",
    "ok",
  ],
  ["assets", { directory: "./public", binding: "ASSETS" }, "ok", "ok"],
  [
    "vars",
    { STORE_LABEL: "probe", FEATURES: { a: 1 }, COUNT: 3, ON: true },
    "ok",
    "ok",
  ],
  ["observability", { enabled: false }, "ok", "ok"],
  ["observability", {}, "ok", "ok"],
  // override
  ["name", "anything", "ok", "ok"],
  ["workers_dev", true, "ok", "ok"],
  ["preview_urls", true, "ok", "ok"],
  // ignore
  ["$schema", "node_modules/wrangler/config-schema.json", "ok", "ok"],
  ["dev", { port: 8787, ip: "0.0.0.0", enable_containers: true }, "ok", "ok"],
  ["keep_vars", true, "ok", "ok"],
  ["send_metrics", false, "ok", "ok"],
  // adapter metadata: the emitted shape's bookkeeping, not an author setting
  [
    "configPath",
    "/workspace/.morph/wrangler.json",
    "NATIVE_WRANGLER_SETTING_UNKNOWN",
    "ok",
  ],
  [
    "userConfigPath",
    "/workspace/.morph/wrangler.json",
    "NATIVE_WRANGLER_SETTING_UNKNOWN",
    "ok",
  ],
  ["topLevelName", "shop", "NATIVE_WRANGLER_SETTING_UNKNOWN", "ok"],
  ["definedEnvironments", [], "NATIVE_WRANGLER_SETTING_UNKNOWN", "ok"],
  // the pinned adapter's exact defaults
  ["no_bundle", true, "NATIVE_WRANGLER_SETTING_UNSUPPORTED", "ok"],
  [
    "no_bundle",
    false,
    "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
    "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
  ],
  [
    "rules",
    [{ type: "ESModule", globs: ["**/*.js", "**/*.mjs"] }],
    "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
    "ok",
  ],
  [
    "rules",
    [{ type: "Text", globs: ["**/*.txt"] }],
    "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
    "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
  ],
  [
    "jsx_factory",
    "React.createElement",
    "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
    "ok",
  ],
  [
    "jsx_factory",
    "h",
    "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
    "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
  ],
  [
    "jsx_fragment",
    "React.Fragment",
    "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
    "ok",
  ],
  [
    "python_modules",
    { exclude: ["**/*.pyc"] },
    "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
    "ok",
  ],
  ["triggers", {}, "ok", "ok"],
  [
    "triggers",
    { crons: ["0 * * * *"] },
    "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
    "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
  ],
  ["previews", {}, "ok", "ok"],
  [
    "previews",
    { vars: { A: "1" } },
    "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
    "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
  ],
  // refused
  [
    "routes",
    [{ pattern: "shop.example.com/*", zone_name: "example.com" }],
    "NATIVE_ROUTE_CLAIM",
    "NATIVE_ROUTE_CLAIM",
  ],
  [
    "route",
    { pattern: "shop.example.com", custom_domain: true },
    "NATIVE_ROUTE_CLAIM",
    "NATIVE_ROUTE_CLAIM",
  ],
  [
    "account_id",
    "0123456789abcdef",
    "NATIVE_DEPLOY_TARGET",
    "NATIVE_DEPLOY_TARGET",
  ],
  [
    "env",
    { staging: { vars: { A: "1" } } },
    "NATIVE_WRANGLER_ENVIRONMENTS",
    "NATIVE_WRANGLER_ENVIRONMENTS",
  ],
  [
    "legacy_env",
    true,
    "NATIVE_WRANGLER_ENVIRONMENTS",
    "NATIVE_WRANGLER_ENVIRONMENTS",
  ],
  [
    "secrets",
    { required: ["API_KEY"] },
    "NATIVE_SECRET_UNMAPPED",
    "NATIVE_SECRET_UNMAPPED",
  ],
  [
    "tail_consumers",
    [{ service: "tail" }],
    "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
    "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
  ],
  [
    "streaming_tail_consumers",
    [{ service: "tail" }],
    "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
    "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
  ],
  [
    "logpush",
    true,
    "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
    "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
  ],
  [
    "limits",
    { cpu_ms: 50 },
    "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
    "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
  ],
  [
    "placement",
    { mode: "smart" },
    "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
    "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
  ],
  ...[
    "build",
    "site",
    "alias",
    "define",
    "minify",
    "keep_names",
    "tsconfig",
    "upload_source_maps",
    "find_additional_modules",
    "base_dir",
    "preserve_file_names",
    "node_compat",
  ].map((key): [string, unknown, Expect, Expect] => [
    key,
    key === "build"
      ? { command: "make" }
      : key === "tsconfig" || key === "base_dir"
        ? "./x"
        : true,
    "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
    "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
  ]),
  // bindings: refused once declared; empty is the adapter's default
  [
    "kv_namespaces",
    [{ binding: "CACHE", id: "x" }],
    "NATIVE_BINDINGS_UNMAPPED",
    "NATIVE_BINDINGS_UNMAPPED",
  ],
  ["kv_namespaces", [], "ok", "ok"],
  [
    "d1_databases",
    [{ binding: "DB", database_id: "x" }],
    "NATIVE_BINDINGS_UNMAPPED",
    "NATIVE_BINDINGS_UNMAPPED",
  ],
  [
    "d1_databases",
    [{ binding: "DB", database_id: "x", remote: true }],
    "NATIVE_REMOTE_BINDING",
    "NATIVE_REMOTE_BINDING",
  ],
  [
    "r2_buckets",
    [{ binding: "R2", bucket_name: "x" }],
    "NATIVE_BINDINGS_UNMAPPED",
    "NATIVE_BINDINGS_UNMAPPED",
  ],
  [
    "durable_objects",
    { bindings: [{ name: "DO", class_name: "X" }] },
    "NATIVE_BINDINGS_UNMAPPED",
    "NATIVE_BINDINGS_UNMAPPED",
  ],
  ["durable_objects", { bindings: [] }, "ok", "ok"],
  [
    "migrations",
    [{ tag: "v1", new_classes: ["X"] }],
    "NATIVE_BINDINGS_UNMAPPED",
    "NATIVE_BINDINGS_UNMAPPED",
  ],
  // Today's deploy check missed queue producers and single-value bindings.
  [
    "queues",
    { producers: [{ binding: "Q", queue: "q" }] },
    "NATIVE_BINDINGS_UNMAPPED",
    "NATIVE_BINDINGS_UNMAPPED",
  ],
  ["queues", { producers: [], consumers: [] }, "ok", "ok"],
  [
    "ai",
    { binding: "AI" },
    "NATIVE_BINDINGS_UNMAPPED",
    "NATIVE_BINDINGS_UNMAPPED",
  ],
  [
    "ai",
    { binding: "AI", remote: true },
    "NATIVE_REMOTE_BINDING",
    "NATIVE_REMOTE_BINDING",
  ],
  [
    "browser",
    { binding: "BROWSER" },
    "NATIVE_BINDINGS_UNMAPPED",
    "NATIVE_BINDINGS_UNMAPPED",
  ],
  [
    "images",
    { binding: "IMAGES" },
    "NATIVE_BINDINGS_UNMAPPED",
    "NATIVE_BINDINGS_UNMAPPED",
  ],
  [
    "version_metadata",
    { binding: "CF_VERSION_METADATA" },
    "NATIVE_BINDINGS_UNMAPPED",
    "NATIVE_BINDINGS_UNMAPPED",
  ],
  [
    "services",
    [{ binding: "API", service: "api" }],
    "NATIVE_BINDINGS_UNMAPPED",
    "NATIVE_BINDINGS_UNMAPPED",
  ],
  [
    "services",
    [{ binding: "API", service: "api", remote: true }],
    "NATIVE_REMOTE_BINDING",
    "NATIVE_REMOTE_BINDING",
  ],
  [
    "send_email",
    [{ name: "MAIL" }],
    "NATIVE_BINDINGS_UNMAPPED",
    "NATIVE_BINDINGS_UNMAPPED",
  ],
  [
    "pipelines",
    [{ binding: "P", pipeline: "p" }],
    "NATIVE_BINDINGS_UNMAPPED",
    "NATIVE_BINDINGS_UNMAPPED",
  ],
  [
    "workflows",
    [{ binding: "W", name: "w", class_name: "W" }],
    "NATIVE_BINDINGS_UNMAPPED",
    "NATIVE_BINDINGS_UNMAPPED",
  ],
  [
    "hyperdrive",
    [{ binding: "H", id: "h" }],
    "NATIVE_BINDINGS_UNMAPPED",
    "NATIVE_BINDINGS_UNMAPPED",
  ],
  [
    "vectorize",
    [{ binding: "V", index_name: "v" }],
    "NATIVE_BINDINGS_UNMAPPED",
    "NATIVE_BINDINGS_UNMAPPED",
  ],
  [
    "analytics_engine_datasets",
    [{ binding: "AE" }],
    "NATIVE_BINDINGS_UNMAPPED",
    "NATIVE_BINDINGS_UNMAPPED",
  ],
  [
    "dispatch_namespaces",
    [{ binding: "D", namespace: "d" }],
    "NATIVE_BINDINGS_UNMAPPED",
    "NATIVE_BINDINGS_UNMAPPED",
  ],
  [
    "mtls_certificates",
    [{ binding: "M", certificate_id: "m" }],
    "NATIVE_BINDINGS_UNMAPPED",
    "NATIVE_BINDINGS_UNMAPPED",
  ],
  [
    "secrets_store_secrets",
    [{ binding: "S", store_id: "s", secret_name: "x" }],
    "NATIVE_BINDINGS_UNMAPPED",
    "NATIVE_BINDINGS_UNMAPPED",
  ],
  [
    "containers",
    [{ class_name: "C", image: "./Dockerfile" }],
    "NATIVE_BINDINGS_UNMAPPED",
    "NATIVE_BINDINGS_UNMAPPED",
  ],
  [
    "wasm_modules",
    { MOD: "./a.wasm" },
    "NATIVE_BINDINGS_UNMAPPED",
    "NATIVE_BINDINGS_UNMAPPED",
  ],
  [
    "text_blobs",
    { TXT: "./a.txt" },
    "NATIVE_BINDINGS_UNMAPPED",
    "NATIVE_BINDINGS_UNMAPPED",
  ],
  [
    "data_blobs",
    { BIN: "./a.bin" },
    "NATIVE_BINDINGS_UNMAPPED",
    "NATIVE_BINDINGS_UNMAPPED",
  ],
  [
    "unsafe",
    { bindings: [{ name: "U", type: "x" }] },
    "NATIVE_BINDINGS_UNMAPPED",
    "NATIVE_BINDINGS_UNMAPPED",
  ],
  [
    "ratelimits",
    [{ name: "RL", namespace_id: "1", simple: { limit: 1, period: 60 } }],
    "NATIVE_BINDINGS_UNMAPPED",
    "NATIVE_BINDINGS_UNMAPPED",
  ],
  [
    "worker_loaders",
    [{ binding: "L" }],
    "NATIVE_BINDINGS_UNMAPPED",
    "NATIVE_BINDINGS_UNMAPPED",
  ],
  [
    "logfwdr",
    { bindings: [{ name: "F", destination: "x" }] },
    "NATIVE_BINDINGS_UNMAPPED",
    "NATIVE_BINDINGS_UNMAPPED",
  ],
  // an empty value that is not the adapter's default
  ["ai", {}, "ok", "NATIVE_WRANGLER_SETTING_UNSUPPORTED"],
  ["kv_namespaces", {}, "ok", "NATIVE_WRANGLER_SETTING_UNSUPPORTED"],
  // unknown, top level and nested, empty values included
  [
    "compliance_region",
    "eu",
    "NATIVE_WRANGLER_SETTING_UNKNOWN",
    "NATIVE_WRANGLER_SETTING_UNKNOWN",
  ],
  [
    "remoteBindings",
    false,
    "NATIVE_WRANGLER_SETTING_UNKNOWN",
    "NATIVE_WRANGLER_SETTING_UNKNOWN",
  ],
  [
    "some_future_key",
    {},
    "NATIVE_WRANGLER_SETTING_UNKNOWN",
    "NATIVE_WRANGLER_SETTING_UNKNOWN",
  ],
  [
    "some_future_key",
    [],
    "NATIVE_WRANGLER_SETTING_UNKNOWN",
    "NATIVE_WRANGLER_SETTING_UNKNOWN",
  ],
  [
    "assets",
    { directory: "./public", future: {} },
    "NATIVE_WRANGLER_SETTING_UNKNOWN",
    "NATIVE_WRANGLER_SETTING_UNKNOWN",
  ],
  [
    "observability",
    { enabled: true, future: false },
    "NATIVE_WRANGLER_SETTING_UNKNOWN",
    "NATIVE_WRANGLER_SETTING_UNKNOWN",
  ],
  // asset routing: Core decides which layer answers
  [
    "assets",
    { run_worker_first: true },
    "NATIVE_WRANGLER_ASSET_ROUTING",
    "NATIVE_WRANGLER_ASSET_ROUTING",
  ],
  [
    "assets",
    { html_handling: "none" },
    "NATIVE_WRANGLER_ASSET_ROUTING",
    "NATIVE_WRANGLER_ASSET_ROUTING",
  ],
  [
    "assets",
    { not_found_handling: "single-page-application" },
    "NATIVE_WRANGLER_ASSET_ROUTING",
    "NATIVE_WRANGLER_ASSET_ROUTING",
  ],
  // observability: only `enabled`
  [
    "observability",
    { enabled: true, head_sampling_rate: 0.1 },
    "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
    "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
  ],
  [
    "observability",
    { logs: { enabled: true, destinations: ["x"] } },
    "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
    "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
  ],
  [
    "observability",
    { traces: { enabled: true } },
    "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
    "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
  ],
  // typed values
  [
    "observability",
    { enabled: "yes" },
    "NATIVE_WRANGLER_CONFIG",
    "NATIVE_WRANGLER_CONFIG",
  ],
  ["observability", true, "NATIVE_WRANGLER_CONFIG", "NATIVE_WRANGLER_CONFIG"],
  [
    "compatibility_flags",
    "nodejs_compat",
    "NATIVE_WRANGLER_CONFIG",
    "NATIVE_WRANGLER_CONFIG",
  ],
  [
    "compatibility_date",
    "next week",
    "NATIVE_WRANGLER_CONFIG",
    "NATIVE_WRANGLER_CONFIG",
  ],
  ["main", 1, "NATIVE_WRANGLER_CONFIG", "NATIVE_WRANGLER_CONFIG"],
  ["name", 1, "NATIVE_WRANGLER_CONFIG", "NATIVE_WRANGLER_CONFIG"],
  ["workers_dev", "false", "NATIVE_WRANGLER_CONFIG", "NATIVE_WRANGLER_CONFIG"],
  [
    "assets",
    { binding: "not a name" },
    "NATIVE_WRANGLER_CONFIG",
    "NATIVE_WRANGLER_CONFIG",
  ],
  ["assets", "./public", "NATIVE_WRANGLER_CONFIG", "NATIVE_WRANGLER_CONFIG"],
  ["vars", ["A"], "NATIVE_WRANGLER_CONFIG", "NATIVE_WRANGLER_CONFIG"],
  // vars and the env name registry
  ["vars", { "BAD-NAME": "x" }, "NATIVE_VARS_INVALID", "NATIVE_VARS_INVALID"],
  ["vars", { EMPTY: null }, "NATIVE_VARS_INVALID", "NATIVE_VARS_INVALID"],
  [
    "vars",
    { BIG: "x".repeat(5 * 1024 + 1) },
    "NATIVE_VARS_INVALID",
    "NATIVE_VARS_INVALID",
  ],
  [
    "vars",
    Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`V${i}`, "x"])),
    "NATIVE_VARS_INVALID",
    "NATIVE_VARS_INVALID",
  ],
  [
    "vars",
    { MORPH_BUILD_ID: "x" },
    "NATIVE_BINDING_NAME_CLASH",
    "NATIVE_BINDING_NAME_CLASH",
  ],
  [
    "vars",
    { morph_anything: "x" },
    "NATIVE_BINDING_NAME_CLASH",
    "NATIVE_BINDING_NAME_CLASH",
  ],
  [
    "assets",
    { binding: "MORPH_ASSETS" },
    "NATIVE_BINDING_NAME_CLASH",
    "NATIVE_BINDING_NAME_CLASH",
  ],
];

describe("the Wrangler key contract", () => {
  it("accepts the guide's config as written", () => {
    expect(author(AUTHOR_BASE)).toBeNull();
  });

  it("accepts the Worker config the pinned plugin wrote for it", () => {
    expect(emitted(EMITTED_BASE)).toBeNull();
  });

  it("accepts every platform and Astro output the pinned plugin wrote, read in the emitted shape", () => {
    // Not that these are held to it (only native Start artifacts are): the
    // table's adapter defaults are the pinned plugin's own, whichever Theme
    // it built.
    for (const id of [
      "starter-v11",
      "starter-v15",
      "starter-v20",
      "starter-v26",
      "starter-v28",
      "starter-v29",
      "starter-v32",
      "platform-saved-2026-09-28",
      "astro-native",
    ] as const) {
      expect(emitted(JSON.parse(emittedFixtures[id].config)), id).toBeNull();
    }
  });

  it.each(ROWS)(
    "%s = %j: author %s, emitted %s",
    (key, value, inAuthor, inEmitted) => {
      const authorResult = author({ ...AUTHOR_BASE, [key]: value });
      const emittedResult = emitted({ ...EMITTED_BASE, [key]: value });
      expect(authorResult?.code ?? "ok", authorResult?.message).toBe(inAuthor);
      expect(emittedResult?.code ?? "ok", emittedResult?.message).toBe(
        inEmitted,
      );
    },
  );

  it("names the file, the setting, why, and what to do, in one stable form", () => {
    expect(
      author({ ...AUTHOR_BASE, routes: [{ pattern: "shop.example.com/*" }] })
        ?.message,
    ).toBe(
      'NATIVE_ROUTE_CLAIM: wrangler.jsonc sets routes. Morph serves the storefront on its connected domains through Core; a Theme Worker cannot claim routes or domains. Remove "routes" and connect the domain in Settings > Domains.',
    );
    expect(
      author({ ...AUTHOR_BASE, kv_namespaces: [{ binding: "CACHE", id: "x" }] })
        ?.message,
    ).toBe(
      'NATIVE_BINDINGS_UNMAPPED: wrangler.jsonc declares kv_namespaces (binding "CACHE"). Morph does not provide this resource to Themes yet. Remove it, or read data through the Morph SDK.',
    );
    expect(
      author({
        ...AUTHOR_BASE,
        d1_databases: [{ binding: "DB", database_id: "x", remote: true }],
      })?.message,
    ).toBe(
      'NATIVE_REMOTE_BINDING: wrangler.jsonc sets remote: true on d1_databases[0]. Builds never connect to a Cloudflare account. Remove "remote".',
    );
    expect(author({ ...AUTHOR_BASE, future_key: 1 })?.message).toBe(
      'NATIVE_WRANGLER_SETTING_UNKNOWN: wrangler.jsonc sets future_key. Morph deploys only the Wrangler settings it has checked, so a new or misspelled setting is refused rather than dropped. Remove "future_key".',
    );
    expect(
      author({
        ...AUTHOR_BASE,
        observability: { enabled: true, head_sampling_rate: 1 },
      })?.message,
    ).toBe(
      'NATIVE_WRANGLER_SETTING_UNSUPPORTED: wrangler.jsonc sets observability.head_sampling_rate. Morph controls log sampling and destinations for Theme Workers, whose logs can hold shopper data. Remove "observability.head_sampling_rate"; only observability.enabled is kept.',
    );
    expect(emitted({ ...EMITTED_BASE, limits: { cpu_ms: 10 } })?.message).toBe(
      `NATIVE_WRANGLER_SETTING_UNSUPPORTED: ${NATIVE_EMITTED_WORKER_CONFIG_LABEL} sets limits. Morph sets the Theme Worker's limits and placement itself. Remove "limits".`,
    );
    expect(
      author({
        ...AUTHOR_BASE,
        vars: { ASSETS: "x" },
        assets: { binding: "ASSETS" },
      })?.message,
    ).toBe(
      "NATIVE_BINDING_NAME_CLASH: wrangler.jsonc sets vars.ASSETS. assets.binding already names env.ASSETS, and each name in the Worker's env must be unique. Rename one of them.",
    );
  });

  it("never puts a variable's value in a message", () => {
    const secretish = "value-that-must-not-leak";
    for (const vars of [
      { MORPH_X: secretish },
      { "bad name": secretish },
      { BIG: secretish.repeat(400) },
    ]) {
      const refused = author({ ...AUTHOR_BASE, vars });
      expect(refused).not.toBeNull();
      expect(refused!.message).not.toContain(secretish);
    }
  });

  it("requires a compatibility date; main is optional, as it is for the plugin", () => {
    const { compatibility_date: _date, ...noDate } = AUTHOR_BASE;
    expect(author(noDate)?.code).toBe("NATIVE_WRANGLER_CONFIG");
    const { main: _main, ...noMain } = AUTHOR_BASE;
    expect(author(noMain)).toBeNull();
    expect(
      emitted({ ...EMITTED_BASE, compatibility_date: undefined })?.code,
    ).toBe("NATIVE_WRANGLER_CONFIG");
  });

  it("refuses what is not an object", () => {
    expect(
      checkNativeWranglerConfig(null, { shape: "emitted", file: "x" })?.code,
    ).toBe("NATIVE_WRANGLER_CONFIG");
    expect(
      checkNativeWranglerConfig([], { shape: "author", file: "x" })?.code,
    ).toBe("NATIVE_WRANGLER_CONFIG");
  });
});

const plan = (files: Record<string, string>) =>
  planNativeWranglerConfig(new Map(Object.entries(files)), {
    contract: "start-ssr",
  });

const copyOf = (files: Record<string, string>) => {
  const planned = plan(files);
  if (!planned.ok) throw new Error(planned.message);
  expect(planned.file.path).toBe(NATIVE_WRANGLER_CONFIG_PATH);
  return JSON.parse(planned.file.content) as Record<string, unknown>;
};

describe("what reaches the build: Morph's copy of the author's config", () => {
  it("carries only what the contract keeps; dev, $schema and the deploy-time overrides are stripped", () => {
    expect(
      copyOf({
        "wrangler.jsonc": JSON.stringify({
          ...AUTHOR_BASE,
          dev: { port: 1234, ip: "0.0.0.0" },
          keep_vars: true,
          send_metrics: true,
          workers_dev: true,
          preview_urls: true,
          kv_namespaces: [],
          triggers: {},
          vars: { STORE_LABEL: "probe" },
        }),
      }),
    ).toEqual({
      name: "shop",
      compatibility_date: "2025-09-02",
      compatibility_flags: ["nodejs_compat"],
      main: "@tanstack/react-start/server-entry",
      observability: { enabled: true },
      vars: { STORE_LABEL: "probe" },
    });
  });

  it("rebases project paths to the copy's place in .morph/, and keeps a package specifier", () => {
    const files = {
      "src/server.ts": "export default {}",
      "wrangler.jsonc": JSON.stringify({
        ...AUTHOR_BASE,
        main: "./src/server.ts",
        assets: { directory: "./public", binding: "ASSETS" },
      }),
    };
    expect(copyOf(files)).toMatchObject({
      main: "../src/server.ts",
      assets: { directory: "../public", binding: "ASSETS" },
    });
    expect(
      copyOf({
        ...files,
        "wrangler.jsonc": JSON.stringify({
          ...AUTHOR_BASE,
          main: "src/server.ts",
        }),
      }).main,
    ).toBe("../src/server.ts");
    expect(copyOf({ "wrangler.jsonc": JSON.stringify(AUTHOR_BASE) }).main).toBe(
      "@tanstack/react-start/server-entry",
    );
  });

  it.each([
    ["an absolute main", { main: "/home/me/shop/src/server.ts" }],
    ["a main outside the project", { main: "../other/server.ts" }],
    ["a relative main the project does not have", { main: "./src/missing.ts" }],
    ["an absolute assets directory", { assets: { directory: "/var/www" } }],
    [
      "an assets directory outside the project",
      { assets: { directory: "../../x" } },
    ],
  ])("refuses %s", (_label, override) => {
    expect(
      plan({
        "wrangler.jsonc": JSON.stringify({ ...AUTHOR_BASE, ...override }),
      }),
    ).toMatchObject({ ok: false, code: "NATIVE_WRANGLER_CONFIG" });
  });

  it("refuses the author shape's refusals before the build, naming the file", () => {
    expect(
      plan({
        "wrangler.jsonc": `{
  // as written
  "name": "shop",
  "compatibility_date": "2025-09-02",
  "main": "@tanstack/react-start/server-entry",
  "routes": [{ "pattern": "shop.example.com/*" }],
}`,
      }),
    ).toMatchObject({
      ok: false,
      code: "NATIVE_ROUTE_CLAIM",
      message: expect.stringContaining("wrangler.jsonc sets routes."),
    });
    expect(
      plan({
        "wrangler.json": JSON.stringify({ ...AUTHOR_BASE, account_id: "a" }),
      }),
    ).toMatchObject({
      ok: false,
      code: "NATIVE_DEPLOY_TARGET",
      message: expect.stringContaining("wrangler.json sets account_id."),
    });
  });

  it("reads the copy the way the build's Wrangler does (JSONC in, JSON out)", () => {
    const planned = plan({
      "wrangler.jsonc": `{ "name": "shop", "compatibility_date": "2025-09-02", "main": "x", /* c */ }`,
    });
    if (!planned.ok) throw new Error(planned.message);
    expect(parseJsonc(planned.file.content)).toEqual({
      name: "shop",
      compatibility_date: "2025-09-02",
      main: "x",
    });
  });
});

describe("project files a contract build refuses", () => {
  it.each([
    ["wrangler.toml", "NATIVE_WRANGLER_CONFIG"],
    ["sub/wrangler.toml", "NATIVE_WRANGLER_CONFIG"],
    [".dev.vars", "NATIVE_SECRET_UNMAPPED"],
    [".dev.vars.production", "NATIVE_SECRET_UNMAPPED"],
    [".env", "NATIVE_SECRET_UNMAPPED"],
    [".env.local", "NATIVE_SECRET_UNMAPPED"],
    [".env.production", "NATIVE_SECRET_UNMAPPED"],
    [".env.example", "NATIVE_SECRET_UNMAPPED"],
    ["config/env/.env", "NATIVE_SECRET_UNMAPPED"],
  ])("refuses %s", (path, code) => {
    expect(refuseNativeProjectFiles([path])).toMatchObject({ ok: false, code });
    expect(
      plan({ "wrangler.jsonc": JSON.stringify(AUTHOR_BASE), [path]: "A=1" }),
    ).toMatchObject({ ok: false, code });
  });

  it("leaves files that only look alike", () => {
    expect(
      refuseNativeProjectFiles([
        "src/env.ts",
        "src/.envrc-notes.md",
        "docs/dev.vars.md",
      ]),
    ).toBeNull();
  });
});

describe("Astro's planner, which shares the Wrangler copy", () => {
  it("writes the config as written, exactly as before the contract", () => {
    // Keys the contract would strip or refuse reach an Astro build as they
    // always did: Astro is outside the contract's admission boundary.
    const config = {
      name: "astro-shop",
      main: "@astrojs/cloudflare/entrypoints/server",
      compatibility_date: "2026-09-01",
      dev: { port: 1234 },
      observability: { enabled: true, head_sampling_rate: 0.5 },
      placement: { mode: "smart" },
      vars: { MORPH_X: "kept" },
    };
    const planned = planNativeWranglerConfig(
      new Map([["wrangler.jsonc", JSON.stringify(config)]]),
    );
    if (!planned.ok) throw new Error(planned.message);
    expect(planned.file.content).toBe(`${JSON.stringify(config, null, 2)}\n`);
  });
});
