import {
  NATIVE_PRERENDER_REFUSED_READS_PATH,
  themePrerenderContentPluginSource,
} from "../compiler/theme-prerender-content";

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
 * Beside the config, a module hook the build's Node process loads first turns
 * the Cloudflare plugin's debugger port off (`NATIVE_BUILD_HOOKS_PATH`).
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

export function nativeBuildLoaderSource(): string {
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
}): string {
  const plugins = [
    nativeImportGuardPluginSource(),
    // Relative to the build's working directory, the workspace root.
    themePrerenderContentPluginSource(".", {
      refusedReadsPath: NATIVE_PRERENDER_REFUSED_READS_PATH,
    }),
  ];
  const allowed = [...new Set(options.allowedPackages)].sort();
  return `// Written by Morph for this build. The project's own config is imported
// unchanged; Morph adds only the plugins below and the prerender server's
// address.
import fs from "node:fs";
import path from "node:path";
import { mergeConfig } from "vite";
import themeConfig from ${JSON.stringify(`../${options.themeConfigPath}`)};

const workspaceRoot = fs.realpathSync(process.cwd());
const allowedPackages = new Set(${JSON.stringify(allowed)});

export default async (env) => {
  const own = typeof themeConfig === "function" ? await themeConfig(env) : await themeConfig;
  return mergeConfig(own ?? {}, {
    plugins: [
${plugins.map((plugin) => `      ${plugin}`).join(",\n")},
    ],
    // Start prerenders by fetching a Vite preview server it starts on
    // "localhost". In the build container that name binds one loopback
    // family while the fetch connects to the other (ECONNREFUSED), so the
    // server is put on one address both sides agree on. Only the build's
    // own prerender server listens here.
    preview: { host: "127.0.0.1" },
  });
};
`;
}
