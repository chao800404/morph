import {
  NATIVE_PRERENDER_REFUSED_READS_PATH,
  themePrerenderContentPluginSource,
} from "../compiler/theme-prerender-content";
import { themeMorphSdkAliasesSource } from "../compiler/theme-morph-sdk";
import { NATIVE_RESOLUTION_PLUGIN_PATH } from "./native-start-proof";

/**
 * The Vite config a native Start build runs with: the project's own, imported
 * unchanged, plus two plugins of Morph's.
 *
 * - **An import guard**, judged on where an import *resolves*, after the
 *   project's own aliases have run: inside the workspace, or inside an
 *   allowed package; nothing else. The platform build's guard
 *   (theme-sandbox-workspace.ts) judges the import text against aliases
 *   Morph generated; a native project brings its own aliases, so the text
 *   says nothing reliable about where an import lands. Bringing the platform
 *   build onto this rule is a later step.
 * - **The frozen-content plugin**, the one the platform build uses, active
 *   only in the Node preview server Start prerenders through, so prerendered
 *   pages read the build's sealed content and nothing of it reaches the
 *   Worker. Always present: a read it cannot answer — no snapshot, or a path
 *   the snapshot cannot speak for — is recorded and fails the build
 *   (theme-prerender-content.ts, `NativePrerenderContent`).
 *
 * - **The SDK resolution record** (native Start builds, given the pass's
 *   nonce): `morph:native-resolution`, which records where every reserved
 *   SDK name resolved in each environment's final module graph. Morph checks
 *   it, and the SDK sentinels in the output, outside the build
 *   (native-start-proof.ts).
 *
 * Beside the config, a module hook the build's Node process loads first turns
 * the Cloudflare plugin's debugger port off (`NATIVE_BUILD_HOOKS_PATH`) and,
 * for a native Start build, holds the plugin's options to the ones Morph
 * accepts (`NATIVE_ADAPTER_OPTION_REFUSALS`).
 *
 * Nothing here rewrites the project's files; the wrapper sits beside them in
 * `.morph/`, which is Morph's.
 */

export const NATIVE_WRAPPER_CONFIG_PATH = ".morph/vite.config.ts";

/**
 * The module the build's Node process imports first (`--import`), and the
 * module hook it registers.
 *
 * The hook gives the project's `cloudflare(...)` call `inspectorPort: false`,
 * for this build only: the project's config is not rewritten, and the
 * plugin's options are not otherwise reachable — they are closed over where
 * the project calls it, and the plugin reads its inspector port from nothing
 * else. Without it, the server Start prerenders through opens a debugger
 * port: the plugin picks the first free one from 9229 and Miniflare binds it
 * later, so a concurrent build or dev server taking it in between fails every
 * prerendered page with EADDRINUSE.
 */
export const NATIVE_BUILD_HOOKS_PATH = ".morph/native-build-hooks.mjs";
export const NATIVE_BUILD_LOADER_PATH = ".morph/native-build-loader.mjs";

/** `NODE_OPTIONS` for the build: relative to its working directory, the workspace root. */
export const NATIVE_BUILD_NODE_OPTIONS = `--import=./${NATIVE_BUILD_HOOKS_PATH}`;

export function nativeBuildHooksSource(): string {
  return `// Written by Morph for this build (tanstack-start-native-wrapper.ts).
import { register } from "node:module";

register(${JSON.stringify(`./${NATIVE_BUILD_LOADER_PATH.split("/").pop()}`)}, import.meta.url);
`;
}

/**
 * The Cloudflare plugin options a native Start build accepts, and how each
 * other one is refused (design section 1, "adapter-option check"; section 4,
 * `NATIVE_ADAPTER_OPTION`). Checked where the project calls `cloudflare(...)`,
 * so a value computed in the config is seen as the plugin would see it,
 * which a reading of the config's text cannot do.
 *
 * - `viteEnvironment: { name }`: the guide's own option, kept.
 * - `inspectorPort`, `persistState`: development settings; the build sets
 *   its own debugger port and keeps no state.
 * - `remoteBindings: false`, `tunnel: false`: the local behaviour the build
 *   forces anyway.
 * - Anything else, including an option this table does not know yet, is
 *   refused. `configPath` and `config` would replace or rewrite the Wrangler
 *   config Morph supplies (`CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH`);
 *   `auxiliaryWorkers` would build Workers Morph never checks or deploys;
 *   `remoteBindings` and `tunnel` reach a Cloudflare account or the network;
 *   `experimental` and `assetsOnly` change what the build emits.
 */
export const NATIVE_ADAPTER_OPTION_REFUSALS: Readonly<
  Record<string, readonly [code: string, why: string]>
> = {
  configPath: [
    "NATIVE_ADAPTER_OPTION",
    "Morph supplies the Wrangler config the plugin reads, from wrangler.jsonc at the project root; a config path would replace it",
  ],
  config: [
    "NATIVE_ADAPTER_OPTION",
    "A config customiser rewrites the Worker config after Morph has checked it",
  ],
  auxiliaryWorkers: [
    "NATIVE_ADAPTER_OPTION",
    "Morph deploys one Theme Worker; auxiliary Workers would be built but never checked or deployed",
  ],
  remoteBindings: [
    "NATIVE_REMOTE_BINDING",
    "Builds never connect to a Cloudflare account",
  ],
  tunnel: ["NATIVE_ADAPTER_OPTION", "Builds never open a tunnel"],
  experimental: [
    "NATIVE_ADAPTER_OPTION",
    "Experimental options change what the build emits, and Morph has not certified them",
  ],
  assetsOnly: [
    "NATIVE_ADAPTER_OPTION",
    "Morph publishes the Theme Worker; an assets-only build has none",
  ],
};

/** Where the shim records an adapter-option refusal, workspace-relative. */
export const NATIVE_ADAPTER_REFUSAL_PATH =
  ".morph/records/adapter-option-refused.json";

/**
 * The adapter-option check as module source, for the loader shim: a
 * function `morphCheckCloudflareOptions(options)` that throws the refusal,
 * after writing it to `NATIVE_ADAPTER_REFUSAL_PATH` (relative to the build's
 * working directory, the workspace root), so the build's result reports the
 * refusal rather than a failed build.
 */
function adapterOptionCheckSource(configFile: string, nonce: string): string {
  return [
    `const MORPH_REFUSALS = ${JSON.stringify(NATIVE_ADAPTER_OPTION_REFUSALS)};`,
    `const MORPH_CONFIG_FILE = ${JSON.stringify(configFile)};`,
    `const MORPH_REFUSAL_PATH = ${JSON.stringify(NATIVE_ADAPTER_REFUSAL_PATH)};`,
    "function morphRefuseOption(option, why, code) {",
    '  const message = code + ": " + MORPH_CONFIG_FILE + " passes " + option + " to cloudflare(). " + why + ". Remove " + JSON.stringify(option) + "; keep wrangler.jsonc at the project root.";',
    "  try {",
    '    const fs = process.getBuiltinModule("node:fs");',
    '    fs.mkdirSync(MORPH_REFUSAL_PATH.slice(0, MORPH_REFUSAL_PATH.lastIndexOf("/")), { recursive: true });',
    "    fs.writeFileSync(MORPH_REFUSAL_PATH, JSON.stringify({ code, message }));",
    "  } catch {}",
    "  throw new Error(message);",
    "}",
    // The options are read once, here, into a fresh frozen object of plain
    // data: what is checked is exactly what the plugin is given. A getter,
    // a symbol key, a prototype other than Object's, or a value inherited
    // rather than owned is refused rather than read twice.
    "function morphSnapshot(value, what) {",
    '  if (value === null || typeof value !== "object" || Array.isArray(value)) {',
    '    morphRefuseOption(what + " that are not an object", "Morph reads the plugin options as a plain object", "NATIVE_ADAPTER_OPTION");',
    "  }",
    "  const prototype = Object.getPrototypeOf(value);",
    "  if (prototype !== Object.prototype && prototype !== null) {",
    '    morphRefuseOption(what + " that are not a plain object", "Morph reads the plugin options as a plain object, not one that inherits settings", "NATIVE_ADAPTER_OPTION");',
    "  }",
    // Own data properties only, defined (not assigned) on the copy, so no
    // key can set the copy's prototype; the keys that name prototypes are
    // refused outright.
    "  const copy = {};",
    "  for (const key of Reflect.ownKeys(value)) {",
    '    if (typeof key !== "string") morphRefuseOption(what + " with a symbol key", "Morph reads the plugin options by name", "NATIVE_ADAPTER_OPTION");',
    '    if (key === "__proto__" || key === "constructor" || key === "prototype") morphRefuseOption(key + " in " + what, "Morph reads the plugin options as plain settings, not prototypes", "NATIVE_ADAPTER_OPTION");',
    "    const descriptor = Object.getOwnPropertyDescriptor(value, key);",
    '    if (!descriptor || !("value" in descriptor)) morphRefuseOption(key + " as a getter", "Morph reads each plugin option once, as a value", "NATIVE_ADAPTER_OPTION");',
    "    Object.defineProperty(copy, key, { value: descriptor.value, enumerable: true, writable: true, configurable: true });",
    "  }",
    "  return copy;",
    "}",
    "function morphCheckCloudflareOptions(options) {",
    "  if (options === undefined) return Object.freeze({});",
    '  const checked = morphSnapshot(options, "options");',
    "  for (const key of Object.keys(checked)) {",
    "    const value = checked[key];",
    '    if (key === "inspectorPort" || key === "persistState") continue;',
    '    if ((key === "remoteBindings" || key === "tunnel") && value === false) continue;',
    '    if (key === "viteEnvironment") {',
    '      const environment = morphSnapshot(value, "viteEnvironment options");',
    "      const ok =",
    '        Object.keys(environment).every((name) => name === "name") &&',
    '        (environment.name === undefined || typeof environment.name === "string");',
    "      if (ok) {",
    "        checked.viteEnvironment = Object.freeze(environment);",
    "        continue;",
    "      }",
    '      morphRefuseOption("viteEnvironment other than { name }", "Morph builds one Worker environment, named by viteEnvironment.name", "NATIVE_ADAPTER_OPTION");',
    "    }",
    "    const known = Object.prototype.hasOwnProperty.call(MORPH_REFUSALS, key) ? MORPH_REFUSALS[key] : null;",
    "    if (known) morphRefuseOption(key, known[1], known[0]);",
    '    morphRefuseOption(key, "Morph has not certified this option of the Cloudflare plugin", "NATIVE_ADAPTER_OPTION");',
    "  }",
    "  return Object.freeze(checked);",
    "}",
    // Each plugin object the checked call returns is registered in a WeakSet
    // only this pass's shim and wrapper can name (the key carries the pass's
    // nonce), so the wrapper can tell a Cloudflare plugin made through this
    // check from one made some other way. Each call is recorded, with the
    // keys it passed and its environment, for the collector to check again.
    `const MORPH_NONCE = ${JSON.stringify(nonce)};`,
    `const MORPH_CALLS_PATH = ${JSON.stringify(NATIVE_ADAPTER_CALLS_PATH)};`,
    'const MORPH_REGISTRY_KEY = Symbol.for("morph.cloudflare.registry:" + MORPH_NONCE);',
    "if (!Object.prototype.hasOwnProperty.call(globalThis, MORPH_REGISTRY_KEY)) {",
    "  Object.defineProperty(globalThis, MORPH_REGISTRY_KEY, { value: new WeakSet(), writable: false, configurable: false, enumerable: false });",
    "}",
    "const MORPH_REGISTRY = globalThis[MORPH_REGISTRY_KEY];",
    "function morphRegisterCloudflarePlugins(plugins, checked) {",
    "  const visit = (value) => {",
    "    if (Array.isArray(value)) { value.forEach(visit); return; }",
    '    if (value && typeof value === "object") MORPH_REGISTRY.add(value);',
    "  };",
    "  visit(plugins);",
    "  try {",
    '    const fs = process.getBuiltinModule("node:fs");',
    '    fs.mkdirSync(MORPH_CALLS_PATH.slice(0, MORPH_CALLS_PATH.lastIndexOf("/")), { recursive: true });',
    "    let record = { nonce: MORPH_NONCE, calls: [] };",
    "    try {",
    '      const existing = JSON.parse(fs.readFileSync(MORPH_CALLS_PATH, "utf8"));',
    "      if (existing && existing.nonce === MORPH_NONCE && Array.isArray(existing.calls)) record = existing;",
    "    } catch {}",
    "    record.calls.push({",
    "      keys: Object.keys(checked).sort(),",
    '      environment: checked.viteEnvironment && typeof checked.viteEnvironment.name === "string" ? checked.viteEnvironment.name : null,',
    "    });",
    "    fs.writeFileSync(MORPH_CALLS_PATH, JSON.stringify(record));",
    "  } catch {}",
    "  return plugins;",
    "}",
  ].join("\n");
}

/** Where the checked `cloudflare()` calls are counted, workspace-relative. */
export const NATIVE_ADAPTER_CALLS_PATH = ".morph/records/adapter-calls.json";

/**
 * The wrapper's check, as source: every Cloudflare plugin in the project's
 * resolved plugin list carries the mark the checked call gives it. One the
 * project built some other way (a `require`, the plugin's internals) was not
 * checked, and is refused.
 */
function cloudflarePluginMarkCheckSource(configFile: string): string {
  return `
  const checkedRegistry = globalThis[Symbol.for("morph.cloudflare.registry:" + morphBuildNonce)];
  const flatten = async (value) => {
    const resolved = await value;
    if (Array.isArray(resolved)) return (await Promise.all(resolved.map(flatten))).flat();
    return resolved && typeof resolved === "object" ? [resolved] : [];
  };
  for (const plugin of await flatten(own?.plugins ?? [])) {
    if (typeof plugin.name === "string" && plugin.name.startsWith("vite-plugin-cloudflare") && !(checkedRegistry instanceof WeakSet && checkedRegistry.has(plugin))) {
      const message = ${JSON.stringify(
        `NATIVE_ADAPTER_OPTION: ${configFile} builds the Cloudflare plugin without calling cloudflare() from an import of @cloudflare/vite-plugin, so Morph cannot check its options. Import cloudflare from "@cloudflare/vite-plugin" and call it in the config.`,
      )};
      try {
        fs.mkdirSync(path.join(workspaceRoot, ".morph", "records"), { recursive: true });
        fs.writeFileSync(path.join(workspaceRoot, ${JSON.stringify(NATIVE_ADAPTER_REFUSAL_PATH)}), JSON.stringify({ code: "NATIVE_ADAPTER_OPTION", message }));
      } catch {}
      throw new Error(message);
    }
  }
`;
}

/**
 * The loader shim. Without options it is the shim every native build had
 * (Astro's, byte for byte). With `adapterOptions` (the native Start build),
 * the shimmed `cloudflare(options)` first holds the options to
 * `NATIVE_ADAPTER_OPTION_REFUSALS`, then also forces `remoteBindings: false`.
 */
export function nativeBuildLoaderSource(
  options: Readonly<{ adapterOptions?: Readonly<{ configFile: string; nonce: string }> }> = {},
): string {
  if (options.adapterOptions) {
    return nativeStartBuildLoaderSource(
      options.adapterOptions.configFile,
      options.adapterOptions.nonce,
    );
  }
  return `// Written by Morph for this build (tanstack-start-native-wrapper.ts).
// An import of the Cloudflare Vite plugin from outside it gets the plugin
// with \`cloudflare(options)\` given \`inspectorPort: false\`; everything else
// it exports is its own. The plugin's own imports, and the shim's import of
// the plugin, resolve as they always do.
const PLUGIN = "/node_modules/@cloudflare/vite-plugin/";
const isPlugin = (url) =>
  typeof url === "string" && url.startsWith("file:") && url.includes(PLUGIN);

export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);
  const parent = context.parentURL;
  if (!isPlugin(resolved.url) || isPlugin(parent) || parent?.startsWith("data:")) {
    return resolved;
  }
  const plugin = JSON.stringify(resolved.url);
  const shim = [
    "import { cloudflare as projectCloudflare } from " + plugin + ";",
    "export * from " + plugin + ";",
    "export function cloudflare(options) {",
    "  return projectCloudflare({ ...options, inspectorPort: false });",
    "}",
  ].join("\\n");
  return {
    shortCircuit: true,
    url: "data:text/javascript," + encodeURIComponent(shim),
  };
}
`;
}

/**
 * The native Start build's loader shim: the one above, with the
 * adapter-option check and `remoteBindings: false` added to the shimmed
 * call. The shim is a data: module, so it carries its own copy of the check.
 */
function nativeStartBuildLoaderSource(configFile: string, nonce: string): string {
  const check = adapterOptionCheckSource(configFile, nonce);
  return [
    "// Written by Morph for this build (tanstack-start-native-wrapper.ts).",
    "// An import of the Cloudflare Vite plugin from outside it gets the plugin",
    "// with `cloudflare(options)` held to the options a native Start build",
    "// accepts, then given `inspectorPort: false` and `remoteBindings: false`;",
    "// everything else it exports is its own. The plugin's own imports, and",
    "// the shim's import of the plugin, resolve as they always do.",
    'const PLUGIN = "/node_modules/@cloudflare/vite-plugin/";',
    "const isPlugin = (url) =>",
    '  typeof url === "string" && url.startsWith("file:") && url.includes(PLUGIN);',
    `const CHECK = ${JSON.stringify(check)};`,
    "",
    "export async function resolve(specifier, context, nextResolve) {",
    "  const resolved = await nextResolve(specifier, context);",
    "  const parent = context.parentURL;",
    '  if (!isPlugin(resolved.url) || isPlugin(parent) || parent?.startsWith("data:")) {',
    "    return resolved;",
    "  }",
    "  const plugin = JSON.stringify(resolved.url);",
    "  const shim = [",
    '    "import { cloudflare as projectCloudflare } from " + plugin + ";",',
    '    "export * from " + plugin + ";",',
    "    CHECK,",
    '    "export function cloudflare(options) {",',
    '    "  const checked = morphCheckCloudflareOptions(options);",',
    '    "  return morphRegisterCloudflarePlugins(projectCloudflare({ ...checked, inspectorPort: false, remoteBindings: false }), checked);",',
    '    "}",',
    '  ].join("\\n");',
    "  return {",
    "    shortCircuit: true,",
    '    url: "data:text/javascript," + encodeURIComponent(shim),',
    "  };",
    "}",
    "",
  ].join("\n");
}

/**
 * Resolved-path import guard, as plugin source. Reads `allowedPackages`,
 * `workspaceRoot`, `fs` and `path` from the wrapper around it.
 */
export function nativeImportGuardPluginSource(): string {
  return `{
    name: "morph:native-import-guard",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!importer || typeof source !== "string") return null;
      if (/^(\\0|virtual:|cloudflare:|node:)/.test(source)) return null;
      const from = importer.replace(/\\\\/g, "/");
      // Package internals and plugin-made modules were judged where they
      // were first imported from.
      if (from.startsWith("\\0") || from.includes("/node_modules/")) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved || resolved.external) return resolved ?? null;
      const id = resolved.id.split("?")[0].replace(/\\\\/g, "/");
      if (id.startsWith("\\0") || !path.isAbsolute(id)) return resolved;
      const packages = id.lastIndexOf("/node_modules/");
      if (packages >= 0) {
        const parts = id.slice(packages + "/node_modules/".length).split("/");
        const name = parts[0].startsWith("@") ? parts[0] + "/" + parts[1] : parts[0];
        if (!allowedPackages.has(name)) {
          throw new Error('UNAPPROVED_DEPENDENCY: Theme imports "' + source + '" from package "' + name + '", which is not an approved dependency.');
        }
        return resolved;
      }
      const relative = path.relative(workspaceRoot, fs.realpathSync(id));
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error('WORKSPACE_PATH_ESCAPE: Import "' + source + '" resolves outside the Theme.');
      }
      return resolved;
    },
  }`;
}

/** The wrapper's source, importing the project's config at `themeConfigPath`. */
export function nativeWrapperConfigSource(options: {
  themeConfigPath: string;
  allowedPackages: readonly string[];
  /**
   * The build pass's nonce: with it, the wrapper adds Morph's SDK
   * resolution record plugin (native-start-proof.ts), which writes it into
   * each record. Without it, the wrapper is the one before the proof.
   */
  resolutionNonce?: string;
}): string {
  const plugins = [
    nativeImportGuardPluginSource(),
    // Relative to the build's working directory, the workspace root.
    themePrerenderContentPluginSource(".", {
      refusedReadsPath: NATIVE_PRERENDER_REFUSED_READS_PATH,
    }),
    ...(options.resolutionNonce !== undefined
      ? ["morphNativeResolution({ workspaceRoot, nonce: morphBuildNonce })"]
      : []),
  ];
  const allowed = [...new Set(options.allowedPackages)].sort();
  const resolutionImport =
    options.resolutionNonce !== undefined
      ? `import morphNativeResolution from ${JSON.stringify(
          `./${NATIVE_RESOLUTION_PLUGIN_PATH.split("/").pop()}`,
        )};\n`
      : "";
  const resolutionNonce =
    options.resolutionNonce !== undefined
      ? `const morphBuildNonce = ${JSON.stringify(options.resolutionNonce)};\n`
      : "";
  // With the proof (the native Start build), also the check that every
  // Cloudflare plugin came through the checked call.
  const markCheck =
    options.resolutionNonce !== undefined
      ? cloudflarePluginMarkCheckSource(options.themeConfigPath)
      : "";
  return `// Written by Morph for this build. The project's own config is imported
// unchanged; Morph adds only the plugins below and the prerender server's
// address.
import fs from "node:fs";
import path from "node:path";
import { mergeConfig } from "vite";
${resolutionImport}import themeConfig from ${JSON.stringify(`../${options.themeConfigPath}`)};

const workspaceRoot = fs.realpathSync(process.cwd());
const allowedPackages = new Set(${JSON.stringify(allowed)});
${resolutionNonce}
export default async (env) => {
  const own = typeof themeConfig === "function" ? await themeConfig(env) : await themeConfig;
${markCheck}  ${options.resolutionNonce !== undefined ? "const merged = " : "return "}mergeConfig(own ?? {}, {
    plugins: [
${plugins.map((plugin) => `      ${plugin}`).join(",\n")},
    ],
    // The Morph SDK names resolve to Morph's copy in .morph/sdk/
    // (theme-morph-sdk.ts). mergeConfig puts these before the project's own
    // aliases, so a project alias cannot claim them.
    resolve: { alias: ${themeMorphSdkAliasesSource("workspaceRoot")} },
    // Starter 32's Live Preview branch is dead code in a published build,
    // whatever the project's own config defines (theme-preview-start-runtime.ts).
    define: { __MORPH_START_LIVE_PREVIEW__: "false" },
    // Start prerenders by fetching a Vite preview server it starts on
    // "localhost". In the build container that name binds one loopback
    // family while the fetch connects to the other (ECONNREFUSED), so the
    // server is put on one address both sides agree on. Only the build's
    // own prerender server listens here.
    preview: { host: "127.0.0.1" },
  });
${options.resolutionNonce !== undefined ? workerResolutionSource() : ""}};
`;
}

/**
 * Vite builds each Web Worker (a `?worker` import) as its own bundle, with
 * the plugins of `worker.plugins` only, and emits its code as an asset of
 * the parent bundle. The resolution plugin is added there too, after the
 * project's own worker plugins, so each worker bundle is recorded and
 * verified like any chunk (native-start-proof.ts).
 */
function workerResolutionSource(): string {
  return `  const ownWorkerPlugins = own?.worker?.plugins;
  merged.worker = {
    ...merged.worker,
    plugins: () => [
      ...(typeof ownWorkerPlugins === "function" ? ownWorkerPlugins() ?? [] : []),
      morphNativeResolution({ workspaceRoot, nonce: morphBuildNonce, scope: "worker" }),
    ],
  };
  return merged;
`;
}
