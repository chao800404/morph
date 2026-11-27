import { parseJsonc } from "./jsonc";

/**
 * The parts of a native build that belong to the Cloudflare deployment
 * target, not to a framework.
 *
 * docs/astro-theme-plan.md 2.3. Any framework Morph builds natively deploys
 * through the Cloudflare Vite plugin: the project's own Wrangler config is
 * copied for Morph to supply through `CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH`,
 * bindings Morph cannot map yet are refused, and the plugin's record of what
 * it built (`.wrangler/deploy/config.json`) says where the Worker and its
 * static assets are. None of that depends on how the framework lays out its
 * project, so each framework adapter uses this module instead of carrying a
 * copy. What a framework adds — its config file, its wrapper, its command —
 * stays in that framework's module.
 */

/** Where Morph's copy of the project's Wrangler config goes in the workspace. */
export const NATIVE_WRANGLER_CONFIG_PATH = ".morph/wrangler.json";
/** Where the Cloudflare Vite plugin records the config it built for deploying. */
export const NATIVE_DEPLOY_CONFIG_PATH = ".wrangler/deploy/config.json";

const WRANGLER_CONFIG_FILES = ["wrangler.jsonc", "wrangler.json"] as const;

/**
 * Bindings Morph cannot provide yet. They are mapped to Morph's own resources
 * in a later step (docs/start-native-import-plan.md, 基礎設施對應); until then a
 * project that declares one is refused rather than built against nothing.
 */
const BINDING_KEYS = [
  "d1_databases",
  "kv_namespaces",
  "r2_buckets",
  "durable_objects",
  "queues",
  "services",
  "vectorize",
  "hyperdrive",
  "analytics_engine_datasets",
  "ai",
  "browser",
  "workflows",
  "dispatch_namespaces",
  "mtls_certificates",
  "send_email",
  "secrets_store_secrets",
] as const;

type SourceFile = Readonly<{ path: string; content: string }>;

/** How a native build runs, or why it cannot. */
export type NativeThemeBuildPlan =
  | Readonly<{
      ok: true;
      /** The project's files, prepared for the build, plus Morph's own files. */
      workspaceFiles: readonly SourceFile[];
      /** Environment the build runs with. */
      env: Readonly<Record<string, string>>;
      command: readonly string[];
    }>
  | NativeBuildRefusal;

export type NativeBuildRefusal = Readonly<{
  ok: false;
  code: string;
  message: string;
}>;

export const refuseNativeBuild = (
  code: string,
  message: string,
): NativeBuildRefusal => ({
  ok: false,
  code,
  message: `${code}: ${message}`,
});

/**
 * The bindings a Wrangler config — the project's, or the one a build wrote —
 * declares that Morph cannot map yet. Top level and `previews` alike: both
 * come from the same author setting.
 */
export function unmappedBindings(
  config: Readonly<Record<string, unknown>>,
): readonly string[] {
  const sections = [
    config,
    ...(config.previews && typeof config.previews === "object"
      ? [config.previews as Record<string, unknown>]
      : []),
  ];
  return BINDING_KEYS.filter((key) =>
    sections.some((section) => declaresSomething(section[key])),
  );
}

/**
 * Whether a binding field holds anything. Wrangler writes its normalised
 * config with every field present and empty (`durable_objects: { bindings:
 * [] }`, `queues: { producers: [], consumers: [] }`), so presence is not
 * declaration: an array declares something when it has an entry, an object
 * when any of its values does or is a plain value (`ai: { binding: "AI" }`).
 */
function declaresSomething(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") {
    return Object.values(value).some(
      (inner) =>
        inner !== undefined &&
        inner !== null &&
        (typeof inner !== "object" || declaresSomething(inner)),
    );
  }
  return true;
}

/**
 * Directories a native build's tools and Morph write in the workspace. A
 * project's source never supplies them: `.wrangler/` holds the Cloudflare
 * plugin's record of what it built (which the artifact is collected from) and
 * Miniflare's local state (which a prerender would read as its KV, D1 and
 * R2), and `.morph/` holds Morph's wrapper and the build's records.
 */
const NATIVE_RESERVED_DIRECTORIES = [".wrangler/", ".morph/"] as const;

export function refuseNativeReservedPaths(
  files: readonly Readonly<{ path: string }>[],
): NativeBuildRefusal | null {
  const reserved = files
    .map((file) => file.path)
    .filter((path) =>
      NATIVE_RESERVED_DIRECTORIES.some((directory) =>
        path.toLowerCase().startsWith(directory),
      ),
    );
  return reserved.length > 0
    ? refuseNativeBuild(
        "NATIVE_RESERVED_PATH",
        `The project carries ${reserved.slice(0, 5).join(", ")}${reserved.length > 5 ? ", …" : ""}; .wrangler/ and .morph/ are written by the build itself and cannot come from the Theme's source.`,
      )
    : null;
}

/**
 * Morph's copy of the project's Wrangler config, the file the Cloudflare
 * plugin is pointed at, or why the project's config cannot be supplied.
 *
 * The project has exactly one `wrangler.jsonc` or `wrangler.json`; it is read
 * as written and declares no binding Morph cannot map.
 *
 * `contract: "start-ssr"` holds the config to the Wrangler key contract
 * (`checkNativeWranglerConfig`, author shape) and writes a copy carrying only
 * what the build may read (`nativeWranglerBuildCopy`). Without it — Astro's
 * planner — the copy is the config as written, exactly as before the
 * contract, so an Astro build's input does not change.
 */
export function planNativeWranglerConfig(
  byPath: ReadonlyMap<string, string>,
  options: Readonly<{ contract?: "start-ssr" }> = {},
): Readonly<{ ok: true; file: SourceFile }> | NativeBuildRefusal {
  if (options.contract === "start-ssr") {
    const refused = refuseNativeProjectFiles([...byPath.keys()]);
    if (refused) return refused;
  }
  const wranglerConfigs = WRANGLER_CONFIG_FILES.filter((path) =>
    byPath.has(path),
  );
  if (wranglerConfigs.length !== 1) {
    return refuseNativeBuild(
      "NATIVE_WRANGLER_CONFIG",
      wranglerConfigs.length === 0
        ? "The project has no wrangler.jsonc."
        : "The project has both wrangler.jsonc and wrangler.json.",
    );
  }
  let wrangler: Record<string, unknown>;
  try {
    const parsed = parseJsonc(byPath.get(wranglerConfigs[0]!)!);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    wrangler = parsed as Record<string, unknown>;
  } catch (error) {
    return refuseNativeBuild(
      "NATIVE_WRANGLER_CONFIG",
      `${wranglerConfigs[0]} could not be read (${error instanceof Error ? error.message : "invalid"}).`,
    );
  }
  if (options.contract === "start-ssr") {
    const file = wranglerConfigs[0]!;
    const refused = checkNativeWranglerConfig(wrangler, {
      shape: "author",
      file,
    });
    if (refused) return refused;
    const copy = nativeWranglerBuildCopy(wrangler, byPath, file);
    if (!copy.ok) return copy;
    return {
      ok: true,
      file: {
        path: NATIVE_WRANGLER_CONFIG_PATH,
        content: `${JSON.stringify(copy.config, null, 2)}\n`,
      },
    };
  }
  const declaredBindings = unmappedBindings(wrangler);
  if (declaredBindings.length > 0) {
    return refuseNativeBuild(
      "NATIVE_BINDINGS_UNMAPPED",
      `${wranglerConfigs[0]} declares ${declaredBindings.join(", ")}, which Morph cannot map to its own resources yet.`,
    );
  }
  return {
    ok: true,
    file: {
      path: NATIVE_WRANGLER_CONFIG_PATH,
      content: `${JSON.stringify(wrangler, null, 2)}\n`,
    },
  };
}

// ---------------------------------------------------------------------------
// The Wrangler key contract (render plan v2 step 1, design section 2).
//
// One table, read in two shapes:
//
// - `author`: the project's own `wrangler.jsonc`, checked when the build is
//   planned, so a refusal names the file and the setting the author wrote;
// - `emitted`: the Worker config the Cloudflare Vite plugin wrote
//   (`runtime/server/wrangler.json` in the artifact), checked again when the
//   artifact is collected and when it is deployed. It carries the adapter's
//   normalised defaults, which are accepted only as the exact values the
//   pinned adapter writes.
//
// Every key Morph has not decided on is refused (fail closed), nested keys
// included. The deploy config is never copied from either shape: it is built
// from the plan (sandbox-wrangler-theme-worker-deployer.ts), which takes
// only what this contract keeps.
//
// Scope: only builds whose immutable compiler identity is the native Start
// build's (`isNativeWranglerContractArtifact`, theme-worker-deployment-plan.ts).
// Astro and every platform build keep the checks they had before the
// contract, so the deploy config of every artifact built before it is
// unchanged.
// ---------------------------------------------------------------------------

/** The shapes the contract reads. */
export type NativeWranglerConfigShape = "author" | "emitted";

/** The emitted Worker config, as a refusal names it. */
export const NATIVE_EMITTED_WORKER_CONFIG_LABEL =
  "runtime/server/wrangler.json (the Worker config the build wrote)";

type Refuse = Readonly<{
  kind: "refuse";
  code: string;
  why: string;
  remedy: string;
  /** Refused even when empty: the key is not one an author file has at all. */
  always?: true;
}>;

/**
 * What the contract does with a key:
 * - `keep`: validated, then carried into the deploy config;
 * - `override`: validated; Morph writes its own value at deploy;
 * - `ignore`: never read, never deployed, and stripped from the copy the
 *   build reads;
 * - `binding`: refused once it declares anything (no binding is mapped in
 *   step 1); in the emitted shape, an empty value is accepted only as the
 *   pinned adapter's exact default;
 * - `default`: emitted shape only, accepted only as the adapter's exact
 *   default value;
 * - `refuse`: refused once it declares anything (`always`: when present).
 */
type KeyRule =
  | Readonly<{ kind: "keep" }>
  | Readonly<{ kind: "override" }>
  | Readonly<{ kind: "ignore" }>
  | Readonly<{ kind: "binding" }>
  | Readonly<{ kind: "default" }>
  | Refuse;

const refuse = (code: string, why: string, remedy: string): Refuse => ({
  kind: "refuse",
  code,
  why,
  remedy,
});

const KEEP = { kind: "keep" } as const;
const OVERRIDE = { kind: "override" } as const;
const IGNORE = { kind: "ignore" } as const;
const BINDING = { kind: "binding" } as const;
const DEFAULT = { kind: "default" } as const;

const UNSUPPORTED_BUNDLING = refuse(
  "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
  "The Cloudflare Vite plugin builds the Worker; Wrangler's own bundling and source settings do not apply, and source maps are not deployed",
  'Remove "{key}" and configure the build in the Vite config',
);
const UNSUPPORTED_MODULE_RULES = refuse(
  "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
  "Morph deploys the prebuilt output with its own module rules",
  'Remove "{key}"',
);
const UNSUPPORTED_SCHEDULE = refuse(
  "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
  "Scheduled and queue-driven invocations are not available to Theme Workers yet",
  'Remove "{key}"',
);
const UNSUPPORTED_LOG_DESTINATION = refuse(
  "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
  "It would send the storefront's logs and traces to a destination Morph does not control",
  'Remove "{key}"; only observability.enabled is kept',
);
const UNSUPPORTED_PLATFORM_OWNED = refuse(
  "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
  "Morph sets the Theme Worker's limits and placement itself",
  'Remove "{key}"',
);
const UNSUPPORTED_PREVIEWS = refuse(
  "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
  "Morph runs its own previews; a Theme cannot configure Cloudflare preview environments",
  'Remove "{key}"',
);
const ROUTE_CLAIM = refuse(
  "NATIVE_ROUTE_CLAIM",
  "Morph serves the storefront on its connected domains through Core; a Theme Worker cannot claim routes or domains",
  'Remove "{key}" and connect the domain in Settings > Domains',
);
const DEPLOY_TARGET = refuse(
  "NATIVE_DEPLOY_TARGET",
  "Morph deploys every Theme Worker to Morph's own Cloudflare account",
  'Remove "{key}"',
);
const ENVIRONMENTS = refuse(
  "NATIVE_WRANGLER_ENVIRONMENTS",
  "Morph deploys one Theme Worker and has no way to tell which Wrangler environment is production",
  'Move the settings to the top level and remove "{key}"',
);
const SECRETS = refuse(
  "NATIVE_SECRET_UNMAPPED",
  "Secrets reach a Theme Worker only from Morph",
  'Remove "{key}"; put non-secret values in "vars"',
);

/**
 * Every binding kind Wrangler knows, the union of the two lists that checked
 * bindings before the contract (the build's `BINDING_KEYS`, the deployment
 * plan's forbidden list) and the kinds the pinned adapter writes. None is
 * mapped in step 1.
 */
const CONTRACT_BINDING_KEYS = [
  "d1_databases",
  "kv_namespaces",
  "r2_buckets",
  "durable_objects",
  "migrations",
  "queues",
  "services",
  "vectorize",
  "hyperdrive",
  "analytics_engine_datasets",
  "ai",
  "browser",
  "workflows",
  "pipelines",
  "dispatch_namespaces",
  "mtls_certificates",
  "send_email",
  "secrets_store_secrets",
  "images",
  "media",
  "containers",
  "cloudchamber",
  "version_metadata",
  "wasm_modules",
  "text_blobs",
  "data_blobs",
  "unsafe",
  "unsafe_hello_world",
  "exports",
  "connect",
  "ai_search_namespaces",
  "ai_search",
  "agent_memory",
  "k2",
  "artifacts",
  "flagship",
  "worker_loaders",
  "ratelimits",
  "vpc_services",
  "vpc_networks",
  "logfwdr",
] as const;

/** Adapter bookkeeping the plugin adds to the config it writes. */
const ADAPTER_METADATA_KEYS = [
  "configPath",
  "userConfigPath",
  "topLevelName",
  "definedEnvironments",
] as const;

/**
 * The key table. One row per top-level key, with its rule in each shape.
 * A key in neither column is refused as unknown.
 */
const WRANGLER_KEY_TABLE: Readonly<
  Record<string, Readonly<{ author: KeyRule; emitted: KeyRule }>>
> = {
  name: { author: OVERRIDE, emitted: OVERRIDE },
  main: { author: KEEP, emitted: KEEP },
  compatibility_date: { author: KEEP, emitted: KEEP },
  compatibility_flags: { author: KEEP, emitted: KEEP },
  assets: { author: KEEP, emitted: KEEP },
  vars: { author: KEEP, emitted: KEEP },
  observability: { author: KEEP, emitted: KEEP },
  workers_dev: { author: OVERRIDE, emitted: OVERRIDE },
  preview_urls: { author: OVERRIDE, emitted: OVERRIDE },
  no_bundle: { author: UNSUPPORTED_MODULE_RULES, emitted: DEFAULT },
  rules: { author: UNSUPPORTED_MODULE_RULES, emitted: DEFAULT },
  jsx_factory: { author: UNSUPPORTED_BUNDLING, emitted: DEFAULT },
  jsx_fragment: { author: UNSUPPORTED_BUNDLING, emitted: DEFAULT },
  python_modules: { author: UNSUPPORTED_BUNDLING, emitted: DEFAULT },
  triggers: { author: UNSUPPORTED_SCHEDULE, emitted: DEFAULT },
  previews: { author: UNSUPPORTED_PREVIEWS, emitted: DEFAULT },
  routes: { author: ROUTE_CLAIM, emitted: ROUTE_CLAIM },
  route: { author: ROUTE_CLAIM, emitted: ROUTE_CLAIM },
  account_id: { author: DEPLOY_TARGET, emitted: DEPLOY_TARGET },
  env: { author: ENVIRONMENTS, emitted: ENVIRONMENTS },
  legacy_env: { author: ENVIRONMENTS, emitted: ENVIRONMENTS },
  secrets: { author: SECRETS, emitted: SECRETS },
  tail_consumers: {
    author: UNSUPPORTED_LOG_DESTINATION,
    emitted: UNSUPPORTED_LOG_DESTINATION,
  },
  streaming_tail_consumers: {
    author: UNSUPPORTED_LOG_DESTINATION,
    emitted: UNSUPPORTED_LOG_DESTINATION,
  },
  logpush: {
    author: UNSUPPORTED_LOG_DESTINATION,
    emitted: UNSUPPORTED_LOG_DESTINATION,
  },
  limits: {
    author: UNSUPPORTED_PLATFORM_OWNED,
    emitted: UNSUPPORTED_PLATFORM_OWNED,
  },
  placement: {
    author: UNSUPPORTED_PLATFORM_OWNED,
    emitted: UNSUPPORTED_PLATFORM_OWNED,
  },
  ...Object.fromEntries(
    [
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
    ].map((key) => [
      key,
      { author: UNSUPPORTED_BUNDLING, emitted: UNSUPPORTED_BUNDLING },
    ]),
  ),
  ...Object.fromEntries(
    CONTRACT_BINDING_KEYS.map((key) => [
      key,
      { author: BINDING, emitted: BINDING },
    ]),
  ),
  $schema: { author: IGNORE, emitted: IGNORE },
  dev: { author: IGNORE, emitted: IGNORE },
  keep_vars: { author: IGNORE, emitted: IGNORE },
  send_metrics: { author: IGNORE, emitted: IGNORE },
  ...Object.fromEntries(
    ADAPTER_METADATA_KEYS.map((key) => [
      key,
      // An author file carrying the adapter's bookkeeping is not a config
      // Morph knows how to read.
      {
        author: {
          ...refuse(
            "NATIVE_WRANGLER_SETTING_UNKNOWN",
            "It is bookkeeping the Cloudflare plugin writes into its own output, not an author setting",
            'Remove "{key}"',
          ),
          always: true,
        },
        emitted: IGNORE,
      },
    ]),
  ),
};

/**
 * The exact values the pinned `@cloudflare/vite-plugin` writes for the keys
 * it fills in whatever the author wrote (measured on the Starter v32 and
 * native Start builds of 2026-11-27, service/__fixtures__/
 * theme-worker-emitted-configs.json). A different value means the author set
 * something, or the adapter changed: either way it is refused until the
 * table says what to do with it.
 */
const PINNED_ADAPTER_DEFAULTS: Readonly<Record<string, readonly unknown[]>> = {
  no_bundle: [true],
  rules: [[{ type: "ESModule", globs: ["**/*.js", "**/*.mjs"] }]],
  jsx_factory: ["React.createElement"],
  jsx_fragment: ["React.Fragment"],
  python_modules: [{ exclude: ["**/*.pyc"] }],
  triggers: [{}, { crons: [] }],
  previews: [{}],
  durable_objects: [{ bindings: [] }],
  queues: [{ producers: [], consumers: [] }],
  logfwdr: [{ bindings: [] }],
  exports: [{}],
  cloudchamber: [{}],
};

/** What an emitted binding kind may hold when nothing is declared. */
function isPinnedDefault(key: string, value: unknown): boolean {
  const defaults = PINNED_ADAPTER_DEFAULTS[key];
  if (defaults)
    return defaults.some((candidate) => deepEqual(candidate, value));
  // Every other binding kind the adapter writes is an empty list.
  return Array.isArray(value) && value.length === 0;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => deepEqual(item, b[index]))
    );
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every(
        (key) =>
          Object.prototype.hasOwnProperty.call(b, key) &&
          deepEqual(a[key], b[key]),
      )
    );
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** What Wrangler accepts as a binding or variable name. */
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Names Morph reserves for what it puts in a Theme Worker's env. */
const MORPH_RESERVED_NAME = /^MORPH_/i;
/** Cloudflare's per-Worker variable limits (Workers platform limits). */
const MAX_VARS = 64;
const MAX_VAR_BYTES = 5 * 1024;

const ASSET_ROUTING_KEYS = [
  "run_worker_first",
  "html_handling",
  "not_found_handling",
] as const;
const OBSERVABILITY_DESTINATION_KEYS = [
  "head_sampling_rate",
  "logs",
  "traces",
] as const;

const contractRefusal = (
  code: string,
  file: string,
  setting: string,
  why: string,
  remedy: string,
  verb = "sets",
): NativeBuildRefusal =>
  refuseNativeBuild(code, `${file} ${verb} ${setting}. ${why}. ${remedy}.`);

/** `kv_namespaces (binding "CACHE")`: the names a binding entry declares. */
function describeBinding(key: string, value: unknown): string {
  const names = new Set<string>();
  const visit = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(visit);
    else if (isPlainObject(node)) {
      for (const field of ["binding", "name", "class_name"]) {
        if (typeof node[field] === "string") {
          names.add(node[field] as string);
          return;
        }
      }
      Object.values(node).forEach(visit);
    }
  };
  visit(value);
  const listed = [...names].slice(0, 3).map((name) => `"${name}"`);
  return listed.length > 0
    ? `${key} (binding ${listed.join(", ")}${names.size > 3 ? ", …" : ""})`
    : key;
}

/** `d1_databases[0]`: where a `remote` setting sits in a binding entry. */
function findRemote(value: unknown, at: string): string | null {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findRemote(item, `${at}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (isPlainObject(value)) {
    if (value.remote === true) return at;
    for (const [field, inner] of Object.entries(value)) {
      const found = findRemote(inner, `${at}.${field}`);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Whether a Wrangler config — the project's or the one a build wrote — holds
 * everything the Wrangler key contract allows and nothing else, read in the
 * given shape. The first refusal, or `null`.
 *
 * `file` names the config in the refusal: `wrangler.jsonc` for the author's,
 * `NATIVE_EMITTED_WORKER_CONFIG_LABEL` for the build's.
 */
export function checkNativeWranglerConfig(
  config: unknown,
  options: Readonly<{ shape: NativeWranglerConfigShape; file: string }>,
): NativeBuildRefusal | null {
  const { shape, file } = options;
  if (!isPlainObject(config)) {
    return refuseNativeBuild(
      "NATIVE_WRANGLER_CONFIG",
      `${file} is not a JSON object.`,
    );
  }
  for (const [key, value] of Object.entries(config)) {
    const row = WRANGLER_KEY_TABLE[key];
    if (!row) {
      return contractRefusal(
        "NATIVE_WRANGLER_SETTING_UNKNOWN",
        file,
        key,
        "Morph deploys only the Wrangler settings it has checked, so a new or misspelled setting is refused rather than dropped",
        `Remove "${key}"`,
      );
    }
    const rule = row[shape];
    const refused = checkKey(key, value, rule, options);
    if (refused) return refused;
  }
  if (
    typeof config.compatibility_date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(config.compatibility_date)
  ) {
    // Without one Wrangler takes the day of the build, so the same source
    // would run differently by when it was built. `main` is optional, as it
    // is for the plugin (an assets-only Worker); when set it is checked above.
    return refuseNativeBuild(
      "NATIVE_WRANGLER_CONFIG",
      `${file} sets no compatibility_date. The Worker's runtime behaviour is pinned by it. Add "compatibility_date": "YYYY-MM-DD".`,
    );
  }
  return checkNameRegistry(config, file);
}

function invalidType(file: string, key: string, expected: string) {
  return refuseNativeBuild(
    "NATIVE_WRANGLER_CONFIG",
    `${file} sets ${key} to a value Wrangler does not accept here. It must be ${expected}. Fix "${key}".`,
  );
}

function checkKey(
  key: string,
  value: unknown,
  rule: KeyRule,
  { shape, file }: Readonly<{ shape: NativeWranglerConfigShape; file: string }>,
): NativeBuildRefusal | null {
  switch (rule.kind) {
    case "ignore":
      return null;
    case "default":
      return isPinnedDefault(key, value)
        ? null
        : contractRefusal(
            "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
            file,
            key,
            "It differs from the value the pinned Cloudflare plugin writes, so the project or the plugin set something Morph does not deploy",
            `Remove "${key}" from wrangler.jsonc`,
          );
    case "refuse":
      return rule.always || declaresSomething(value)
        ? contractRefusal(
            rule.code,
            file,
            key,
            rule.why,
            rule.remedy.replaceAll("{key}", key),
          )
        : null;
    case "binding": {
      const remote = findRemote(value, key);
      if (remote) {
        return contractRefusal(
          "NATIVE_REMOTE_BINDING",
          file,
          `remote: true on ${remote}`,
          "Builds never connect to a Cloudflare account",
          'Remove "remote"',
        );
      }
      if (declaresSomething(value)) {
        return contractRefusal(
          "NATIVE_BINDINGS_UNMAPPED",
          file,
          describeBinding(key, value),
          "Morph does not provide this resource to Themes yet",
          "Remove it, or read data through the Morph SDK",
          "declares",
        );
      }
      return shape === "emitted" && !isPinnedDefault(key, value)
        ? contractRefusal(
            "NATIVE_WRANGLER_SETTING_UNSUPPORTED",
            file,
            key,
            "It differs from the value the pinned Cloudflare plugin writes, so the project or the plugin set something Morph does not deploy",
            `Remove "${key}" from wrangler.jsonc`,
          )
        : null;
    }
    case "override":
      if (key === "name" && typeof value !== "string") {
        return invalidType(file, key, "a string");
      }
      if (
        (key === "workers_dev" || key === "preview_urls") &&
        typeof value !== "boolean"
      ) {
        return invalidType(file, key, "true or false");
      }
      return null;
    case "keep":
      return checkKeptKey(key, value, file);
  }
}

function checkKeptKey(
  key: string,
  value: unknown,
  file: string,
): NativeBuildRefusal | null {
  switch (key) {
    case "main":
      return typeof value === "string"
        ? null
        : invalidType(file, key, "a string");
    case "compatibility_date":
      return typeof value === "string"
        ? null
        : invalidType(file, key, 'a date, "YYYY-MM-DD"');
    case "compatibility_flags":
      return Array.isArray(value) &&
        value.every((flag) => typeof flag === "string")
        ? null
        : invalidType(file, key, "a list of strings");
    case "assets": {
      if (!isPlainObject(value)) return invalidType(file, key, "an object");
      for (const [field, inner] of Object.entries(value)) {
        if ((ASSET_ROUTING_KEYS as readonly string[]).includes(field)) {
          return contractRefusal(
            "NATIVE_WRANGLER_ASSET_ROUTING",
            file,
            `assets.${field}`,
            "It decides whether a request reaches a static file or the Worker first, and Core decides the storefront's routing",
            `Remove "assets.${field}"`,
          );
        }
        if (field === "directory") {
          if (typeof inner !== "string") {
            return invalidType(file, "assets.directory", "a path");
          }
          continue;
        }
        if (field === "binding") {
          if (typeof inner !== "string" || !ENV_NAME.test(inner)) {
            return invalidType(file, "assets.binding", "a binding name");
          }
          continue;
        }
        return contractRefusal(
          "NATIVE_WRANGLER_SETTING_UNKNOWN",
          file,
          `assets.${field}`,
          "Morph deploys only the Wrangler settings it has checked, so a new or misspelled setting is refused rather than dropped",
          `Remove "assets.${field}"`,
        );
      }
      return null;
    }
    case "observability": {
      if (!isPlainObject(value)) return invalidType(file, key, "an object");
      for (const [field, inner] of Object.entries(value)) {
        if (field === "enabled") {
          if (typeof inner !== "boolean") {
            return invalidType(file, "observability.enabled", "true or false");
          }
          continue;
        }
        if (
          (OBSERVABILITY_DESTINATION_KEYS as readonly string[]).includes(field)
        ) {
          return contractRefusal(
            UNSUPPORTED_LOG_DESTINATION.code,
            file,
            `observability.${field}`,
            "Morph controls log sampling and destinations for Theme Workers, whose logs can hold shopper data",
            `Remove "observability.${field}"; only observability.enabled is kept`,
          );
        }
        return contractRefusal(
          "NATIVE_WRANGLER_SETTING_UNKNOWN",
          file,
          `observability.${field}`,
          "Morph deploys only the Wrangler settings it has checked, so a new or misspelled setting is refused rather than dropped",
          `Remove "observability.${field}"`,
        );
      }
      return null;
    }
    case "vars": {
      if (!isPlainObject(value)) return invalidType(file, key, "an object");
      const entries = Object.entries(value);
      if (entries.length > MAX_VARS) {
        return contractRefusal(
          "NATIVE_VARS_INVALID",
          file,
          `${entries.length} vars`,
          `A Worker can have at most ${MAX_VARS} variables`,
          "Remove some",
        );
      }
      for (const [name, inner] of entries) {
        // Names only: a variable's value never appears in a message.
        if (!ENV_NAME.test(name)) {
          return contractRefusal(
            "NATIVE_VARS_INVALID",
            file,
            `vars.${JSON.stringify(name)}`,
            "A variable's name is read as env.<name>, so it must be letters, digits and underscores, not starting with a digit",
            "Rename it",
          );
        }
        if (
          inner === null ||
          inner === undefined ||
          !["string", "number", "boolean", "object"].includes(typeof inner)
        ) {
          return contractRefusal(
            "NATIVE_VARS_INVALID",
            file,
            `vars.${name}`,
            "A variable is a string or a JSON value, not null",
            "Give it a value or remove it",
          );
        }
        const size = new TextEncoder().encode(
          typeof inner === "string" ? inner : JSON.stringify(inner),
        ).byteLength;
        if (size > MAX_VAR_BYTES) {
          return contractRefusal(
            "NATIVE_VARS_INVALID",
            file,
            `vars.${name}`,
            `A variable can be at most ${MAX_VAR_BYTES} bytes; this one is ${size}`,
            "Shorten it, or read the data through the Morph SDK",
          );
        }
      }
      return null;
    }
  }
  return null;
}

/**
 * The Theme Worker's env name registry: every name the Worker reads from
 * `env` — its variables, its assets binding, and (none yet) the bindings and
 * secrets Morph provides — is unique, and none is one Morph reserves.
 */
function checkNameRegistry(
  config: Record<string, unknown>,
  file: string,
): NativeBuildRefusal | null {
  const registry = new Map<string, string>();
  const names: Array<[string, string]> = [];
  if (
    isPlainObject(config.assets) &&
    typeof config.assets.binding === "string"
  ) {
    names.push([config.assets.binding, "assets.binding"]);
  }
  if (isPlainObject(config.vars)) {
    for (const name of Object.keys(config.vars))
      names.push([name, `vars.${name}`]);
  }
  for (const [name, setting] of names) {
    if (MORPH_RESERVED_NAME.test(name)) {
      return contractRefusal(
        "NATIVE_BINDING_NAME_CLASH",
        file,
        setting,
        "Names starting with MORPH_ are reserved for what Morph puts in the Theme Worker's env",
        "Rename it",
      );
    }
    const earlier = registry.get(name);
    if (earlier) {
      return contractRefusal(
        "NATIVE_BINDING_NAME_CLASH",
        file,
        setting,
        `${earlier} already names env.${name}, and each name in the Worker's env must be unique`,
        "Rename one of them",
      );
    }
    registry.set(name, setting);
  }
  return null;
}

/**
 * Files a contract build refuses in the project, wherever they are:
 *
 * - `wrangler.toml`: Morph reads no TOML, and the Cloudflare plugin or
 *   Wrangler would read it as readily as the `.jsonc`;
 * - `.dev.vars*` and `.env*`: Wrangler reads them as local variables and
 *   secrets, Vite inlines `VITE_*` values from them into the client bundle
 *   (from any `envDir` and for any `mode` the project's config names), and
 *   the Cloudflare plugin copies them beside the built Worker for
 *   `vite preview`. Secrets reach a Theme Worker only from Morph, so they
 *   are refused rather than silently left out.
 */
export function refuseNativeProjectFiles(
  paths: readonly string[],
): NativeBuildRefusal | null {
  for (const path of paths) {
    const base = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
    if (base === "wrangler.toml") {
      return refuseNativeBuild(
        "NATIVE_WRANGLER_CONFIG",
        `The project has ${path}. Morph reads no TOML, so its settings would reach the build unchecked. Write it as wrangler.jsonc at the project root and remove ${path}.`,
      );
    }
    if (
      base === ".dev.vars" ||
      base.startsWith(".dev.vars.") ||
      base === ".env" ||
      base.startsWith(".env.")
    ) {
      return refuseNativeBuild(
        "NATIVE_SECRET_UNMAPPED",
        `The project has ${path}, a local variables file. Secrets reach a Theme Worker only from Morph, and the build would read it and could ship it with the Worker. Remove ${path}; put non-secret values in "vars" in wrangler.jsonc.`,
      );
    }
  }
  return null;
}

/**
 * The copy of the author's config the Cloudflare plugin reads during the
 * build (`.morph/wrangler.json`, through `CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH`),
 * from a config `checkNativeWranglerConfig` accepted:
 *
 * - only the keys the contract keeps, plus `name` (the plugin names its
 *   output after it); `dev`, `$schema` and every other ignored key are
 *   stripped, so they reach neither Vite nor the deploy, and so are the
 *   empty binding lists and the deploy-time overrides;
 * - paths rebased: the copy sits in `.morph/`, and Wrangler reads `main` and
 *   `assets.directory` relative to the config file, so a project path is
 *   rewritten to the same file from there. A `main` that is not a project
 *   path is a package specifier (the guide's
 *   `@tanstack/react-start/server-entry`) and is kept as written.
 */
export function nativeWranglerBuildCopy(
  config: Readonly<Record<string, unknown>>,
  byPath: ReadonlyMap<string, string>,
  file: string,
):
  Readonly<{ ok: true; config: Record<string, unknown> }> | NativeBuildRefusal {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    const rule = WRANGLER_KEY_TABLE[key]?.author;
    if (rule?.kind !== "keep" && key !== "name") continue;
    if (key === "main") {
      const main = rebaseProjectPath(
        value as string,
        byPath,
        file,
        "main",
        true,
      );
      if (typeof main !== "string") return main;
      copy.main = main;
      continue;
    }
    if (key === "assets") {
      const assets = { ...(value as Record<string, unknown>) };
      if (typeof assets.directory === "string") {
        const directory = rebaseProjectPath(
          assets.directory,
          byPath,
          file,
          "assets.directory",
          false,
        );
        if (typeof directory !== "string") return directory;
        assets.directory = directory;
      }
      copy.assets = assets;
      continue;
    }
    if (key === "observability") {
      const enabled = (value as Record<string, unknown>).enabled;
      copy.observability = enabled === undefined ? {} : { enabled };
      continue;
    }
    copy[key] = value;
  }
  return { ok: true, config: copy };
}

/** A project path, as the file at `.morph/` reaches it; see `nativeWranglerBuildCopy`. */
function rebaseProjectPath(
  value: string,
  byPath: ReadonlyMap<string, string>,
  file: string,
  setting: string,
  mayBeSpecifier: boolean,
): string | NativeBuildRefusal {
  const relativeLike = value.startsWith("./") || value.startsWith("../");
  if (
    value.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.includes("\\")
  ) {
    return refuseNativeBuild(
      "NATIVE_WRANGLER_CONFIG",
      `${file} sets ${setting} to an absolute path. The build runs in Morph's workspace, not on the author's machine. Use a path relative to ${file}.`,
    );
  }
  const normalized = normalizeRelative(value);
  if (normalized === null) {
    return refuseNativeBuild(
      "NATIVE_WRANGLER_CONFIG",
      `${file} sets ${setting} to a path outside the project. Only the project's own files are built. Use a path inside the project.`,
    );
  }
  if (mayBeSpecifier && !relativeLike && !byPath.has(normalized)) {
    return value;
  }
  if (mayBeSpecifier && !byPath.has(normalized)) {
    return refuseNativeBuild(
      "NATIVE_WRANGLER_CONFIG",
      `${file} sets ${setting} to ${value}, which the project does not have. The Cloudflare plugin builds the Worker from it. Point "${setting}" at the server entry.`,
    );
  }
  return normalized === "" ? ".." : `../${normalized}`;
}

export type NativeThemeArtifact = Readonly<{
  /** Files in Morph's artifact layout: `runtime/server/…`, `runtime/client/…`. */
  files: ReadonlyMap<string, Uint8Array | string>;
  workerEntry: string;
  clientAssetsDirectory: string;
}>;

const SERVER_PREFIX = "runtime/server";
const CLIENT_PREFIX = "runtime/client";

/** `a/b/../c` → `a/c`; `null` if it climbs out of the workspace. */
function normalizeRelative(path: string): string | null {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

const text = (content: Uint8Array | string) =>
  typeof content === "string" ? content : new TextDecoder().decode(content);

/**
 * Reads where the Cloudflare plugin put the Worker and its assets, and moves
 * them into Morph's artifact layout. Anything the build wrote outside those
 * two directories is left out.
 *
 * `outputs` are the workspace's files after the build, by workspace-relative
 * path.
 */
export function collectNativeCloudflareArtifact(
  outputs: ReadonlyMap<string, Uint8Array | string>,
): NativeThemeArtifact {
  const deploy = outputs.get(NATIVE_DEPLOY_CONFIG_PATH);
  if (deploy === undefined) {
    throw new Error(
      `NATIVE_ARTIFACT_INCOMPLETE: the build wrote no ${NATIVE_DEPLOY_CONFIG_PATH}.`,
    );
  }
  const configPathValue = (JSON.parse(text(deploy)) as { configPath?: unknown })
    .configPath;
  const serverConfigPath =
    typeof configPathValue === "string"
      ? normalizeRelative(`.wrangler/deploy/${configPathValue}`)
      : null;
  const serverConfig = serverConfigPath
    ? outputs.get(serverConfigPath)
    : undefined;
  if (!serverConfigPath || serverConfig === undefined) {
    throw new Error(
      `NATIVE_ARTIFACT_INCOMPLETE: ${NATIVE_DEPLOY_CONFIG_PATH} names a Worker config the build did not write.`,
    );
  }
  const serverDir = serverConfigPath.slice(
    0,
    serverConfigPath.lastIndexOf("/"),
  );
  const worker = JSON.parse(text(serverConfig)) as {
    main?: unknown;
    assets?: { directory?: unknown };
  };
  const main =
    typeof worker.main === "string"
      ? normalizeRelative(`${serverDir}/${worker.main}`)
      : null;
  if (!main || !main.startsWith(`${serverDir}/`) || !outputs.has(main)) {
    throw new Error(
      "NATIVE_ARTIFACT_INCOMPLETE: the Worker config names an entry the build did not write.",
    );
  }
  const clientDir =
    typeof worker.assets?.directory === "string"
      ? normalizeRelative(`${serverDir}/${worker.assets.directory}`)
      : null;
  if (
    !clientDir ||
    clientDir === serverDir ||
    clientDir.startsWith(`${serverDir}/`)
  ) {
    throw new Error(
      "NATIVE_ARTIFACT_INCOMPLETE: the Worker config names no separate static assets directory.",
    );
  }

  const files = new Map<string, Uint8Array | string>();
  for (const [path, content] of outputs) {
    if (path === serverConfigPath) continue;
    if (path.startsWith(`${serverDir}/`)) {
      files.set(
        `${SERVER_PREFIX}/${path.slice(serverDir.length + 1)}`,
        content,
      );
    } else if (path.startsWith(`${clientDir}/`)) {
      files.set(
        `${CLIENT_PREFIX}/${path.slice(clientDir.length + 1)}`,
        content,
      );
    }
  }
  if (![...files.keys()].some((path) => path.startsWith(`${CLIENT_PREFIX}/`))) {
    throw new Error(
      "NATIVE_ARTIFACT_INCOMPLETE: the build wrote no static assets.",
    );
  }
  // The Worker config moves with the Worker; its assets now sit beside it at
  // the same relative place as in Morph's own builds.
  files.set(
    `${SERVER_PREFIX}/wrangler.json`,
    `${JSON.stringify({ ...worker, assets: { ...worker.assets, directory: "../client" } }, null, 2)}\n`,
  );
  return {
    files,
    workerEntry: `${SERVER_PREFIX}/${main.slice(serverDir.length + 1)}`,
    clientAssetsDirectory: CLIENT_PREFIX,
  };
}
