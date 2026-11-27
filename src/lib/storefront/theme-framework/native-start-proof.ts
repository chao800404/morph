import {
  THEME_MORPH_SDK_MODULES,
  themeMorphSdkFiles,
} from "../compiler/theme-morph-sdk";
import { THEME_START_TOOLCHAIN } from "../compiler/theme-start-toolchain";

/**
 * The SDK resolution proof of a native Start build (render plan v2 step 1,
 * design section 1, "Proof artifacts", item 1).
 *
 * A native build runs the author's own `vite.config`, so the author's plugins
 * can change where `@morph/sdk` resolves, leave it external, or serve other
 * bytes for Morph's copy. Publishing such a build would ship a Theme whose
 * content reads, or whose hide gates, are not Morph's. Two pieces of evidence,
 * of different strength, decide it:
 *
 * 1. **The resolution record**, written by Morph's `morph:native-resolution`
 *    plugin in each Vite environment after the module graph is complete
 *    (`buildEnd`): every import edge of a reserved name in the effective
 *    graph — the code each module was left with after every plugin's
 *    transform — with what that name resolves to through every resolver the
 *    build runs, and whether that module is the graph's actual edge. It runs
 *    in the build's own process, beside the author's plugins, so on its own
 *    it proves nothing: a plugin could rewrite it.
 * 2. **The sentinels**, which Morph checks itself, outside the build, in the
 *    bytes the build wrote: each reserved module's copy ends in a statement
 *    carrying `morph-sdk:start:<pass nonce>:<module>`. An environment whose
 *    record names an edge to that module must carry that string in the
 *    output Morph deploys for it. The nonce is the build pass's own random
 *    value, so no file of the Theme can carry it beforehand. Morph also
 *    scans the deployed JavaScript for a reserved name left as a run-time
 *    import (an externalised SDK), without the record.
 *
 * Author plugins run in the same process, so this is integrity evidence
 * against a build that silently stops reading content through Morph, not a
 * security boundary (design section 1); isolation stays the Sandbox and Core.
 *
 * The verified result is the artifact's `nativeProof` (manifest `runtime`);
 * a native artifact without it is refused for production
 * (theme-worker-deployment-plan.ts).
 */

/**
 * The proof's version. It joins the native Start compiler identity
 * (tanstack-start.framework.ts), so a build made before the proof, or under
 * another version of the plugin or the checks below, is never reused as one
 * that carries it. Change it whenever `nativeResolutionPluginSource`, the
 * sentinel statement or `verifyNativeStartSdkProof` changes
 * (native-start-proof.test.ts pins the plugin's hash to it).
 */
export const NATIVE_PROOF_VERSION = "np-1";

/** Where the plugin writes one record per Vite environment. */
export const NATIVE_RESOLUTION_RECORD_DIR = ".morph/records";
const RECORD_FILE = /^\.morph\/records\/resolution\.([A-Za-z0-9_-]+)\.json$/;

/** The plugin module the wrapper imports, beside it in `.morph/`. */
export const NATIVE_RESOLUTION_PLUGIN_PATH = ".morph/native-resolution.mjs";

/** The `morph:native-resolution` plugin's name, as Vite reports it. */
export const NATIVE_RESOLUTION_PLUGIN_NAME = "morph:native-resolution";

/** Each reserved name's short key in its sentinel. */
function sentinelKey(specifier: string): string {
  const key = specifier === "@morph/sdk" ? "sdk" : specifier.slice("@morph/sdk/".length);
  return key.replace(/[^A-Za-z0-9-]/g, "-");
}

/** The string Morph looks for in an environment that imports `specifier`. */
export function nativeSdkSentinel(nonce: string, specifier: string): string {
  return `morph-sdk:start:${nonce}:${sentinelKey(specifier)}`;
}

/**
 * The SDK files a native Start workspace carries: the platform's copy
 * (theme-morph-sdk.ts), unchanged, with one statement appended to each file
 * a reserved name resolves to. The statement has a side effect, so the
 * bundler keeps it wherever the module is bundled, and minifiers keep the
 * string. Only the native build's copy carries it; the platform build's
 * workspace and Astro's are unchanged.
 */
export function nativeStartSdkFiles(nonce: string): ReadonlyArray<{
  path: string;
  content: string;
}> {
  const byFile = new Map<string, string>();
  for (const [specifier, file] of Object.entries(THEME_MORPH_SDK_MODULES)) {
    byFile.set(file, specifier);
  }
  return themeMorphSdkFiles().map((file) => {
    const specifier = byFile.get(file.path);
    if (!specifier) return file;
    return {
      path: file.path,
      content: `${file.content}${file.content.endsWith("\n") ? "" : "\n"}// Morph's SDK resolution sentinel for this build (native-start-proof.ts).\nReflect.set(globalThis, Symbol.for("morph.sdk.sentinel"), ${JSON.stringify(
        nativeSdkSentinel(nonce, specifier),
      )});\n`,
    };
  });
}

/**
 * The plugin, as an ES module the wrapper imports. Plain JavaScript: it runs
 * in the build's Node process before anything is compiled.
 *
 * `buildEnd` runs once per Vite environment, after every module of that
 * environment's graph is loaded and transformed. For each module outside
 * `node_modules` whose final code names a reserved module, it parses that
 * code, takes each import of a reserved name, resolves it through the full
 * resolver chain (`this.resolve`: aliases, every plugin's `resolveId`,
 * `external`), and records whether that resolution is one of the module's
 * actual graph edges. A module whose code names a reserved module but cannot
 * be parsed is recorded as such, and refused.
 */
export function nativeResolutionPluginSource(): string {
  return String.raw`// Written by Morph for this build (native-start-proof.ts).
import fs from "node:fs";
import path from "node:path";

const RESERVED = /^@morph\/sdk(?:\/.*)?$/;
const MENTION = "@morph/sdk";

function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (typeof node.type === "string") visit(node);
  for (const key of Object.keys(node)) {
    if (key === "start" || key === "end" || key === "loc" || key === "range") continue;
    const value = node[key];
    if (value && typeof value === "object") walk(value, visit);
  }
}

function literal(node) {
  return node && node.type === "Literal" && typeof node.value === "string"
    ? node.value
    : null;
}

function specifiers(ast) {
  const found = new Set();
  walk(ast, (node) => {
    let source = null;
    if (
      node.type === "ImportDeclaration" ||
      node.type === "ExportAllDeclaration" ||
      (node.type === "ExportNamedDeclaration" && node.source)
    ) {
      source = literal(node.source);
    } else if (node.type === "ImportExpression") {
      source = literal(node.source);
    } else if (
      node.type === "CallExpression" &&
      node.callee &&
      node.callee.type === "Identifier" &&
      node.callee.name === "require" &&
      node.arguments.length === 1
    ) {
      source = literal(node.arguments[0]);
    }
    if (source !== null && RESERVED.test(source)) found.add(source);
  });
  return [...found].sort();
}

export default function morphNativeResolution({ workspaceRoot, nonce }) {
  const root = fs.realpathSync(workspaceRoot);
  const where = (id) => {
    const file = String(id).split("?")[0].replace(/\\/g, "/");
    if (file.startsWith("\0")) return { virtual: true };
    if (!path.isAbsolute(file)) return { bare: file };
    let real = file;
    try {
      real = fs.realpathSync(file);
    } catch {}
    const relative = path.relative(root, real).split(path.sep).join("/");
    if (relative.startsWith("..") || path.isAbsolute(relative)) return { outside: true };
    return { path: relative };
  };
  return {
    name: "morph:native-resolution",
    async buildEnd(error) {
      if (error) return;
      const environment = this.environment;
      const name = environment && typeof environment.name === "string" ? environment.name : "default";
      const config = environment && environment.config ? environment.config : {};
      const outDir = path
        .relative(root, path.resolve(config.root || root, (config.build && config.build.outDir) || "dist"))
        .split(path.sep)
        .join("/");
      const edges = [];
      const unparsed = [];
      const sdkModules = new Set();
      for (const id of this.getModuleIds()) {
        const info = this.getModuleInfo(id);
        if (!info || info.isExternal) continue;
        const at = where(id);
        if (at.path && (at.path.startsWith(".morph/sdk/") || at.path === ".morph/section-gate.ts")) {
          sdkModules.add(at.path);
        }
        if (typeof info.code !== "string" || !info.code.includes(MENTION)) continue;
        const file = String(id).split("?")[0].replace(/\\/g, "/");
        if (file.includes("/node_modules/")) continue;
        let ast = info.ast;
        if (!ast) {
          try {
            ast = this.parse(info.code);
          } catch {
            unparsed.push(at.path ?? (at.virtual ? "<virtual>" : "<outside>"));
            continue;
          }
        }
        const graph = new Set([...(info.importedIds || []), ...(info.dynamicallyImportedIds || [])]);
        for (const specifier of specifiers(ast)) {
          const resolved = await this.resolve(specifier, id);
          edges.push({
            importer: at.path ?? (at.virtual ? "<virtual>" : "<outside>"),
            specifier,
            resolved: resolved ? where(resolved.id) : null,
            external: Boolean(resolved && resolved.external),
            inGraph: Boolean(resolved && graph.has(resolved.id)),
          });
        }
      }
      const record = {
        nonce,
        environment: name,
        consumer: config.consumer === "client" ? "client" : config.consumer === "server" ? "server" : null,
        outDir,
        vite: (this.meta && this.meta.viteVersion) || null,
        rollup: (this.meta && this.meta.rollupVersion) || null,
        edges,
        unparsed,
        sdkModules: [...sdkModules].sort(),
      };
      const dir = path.join(root, ".morph", "records");
      fs.mkdirSync(dir, { recursive: true });
      const safe = name.replace(/[^A-Za-z0-9_-]/g, "_");
      fs.writeFileSync(path.join(dir, "resolution." + safe + ".json"), JSON.stringify(record, null, 2));
    },
  };
}
`;
}

/** One environment of the proof, as the manifest keeps it. */
export type NativeSdkProofEnvironment = Readonly<{
  /** The Vite environment's name (`client`, `ssr`, ...). */
  name: string;
  /** Which part of the artifact it built. */
  output: "client" | "server";
  /** Reserved names imported in it, each checked. */
  specifiers: readonly string[];
  /** Import edges of those names, each resolved to Morph's copy. */
  edges: number;
  /** Artifact files where Morph found each imported name's sentinel. */
  sentinelFiles: readonly string[];
}>;

/** What a native Start artifact's manifest records under `runtime.nativeProof`. */
export type NativeBuildProof = Readonly<{
  version: string;
  sdk: Readonly<{
    environments: readonly NativeSdkProofEnvironment[];
  }>;
  toolchain: Readonly<{ vite: string }>;
  /**
   * Static HTML in the artifact's served assets, with where it came from.
   * Kept, not refused, at build time: Build Preview serves every file; a
   * production deployment refuses any (theme-worker-deployment-plan.ts).
   */
  html: readonly Readonly<{ path: string; source: NativeHtmlSource }>[];
}>;

export type NativeHtmlSource = "public" | "spa-shell" | "prerender";

type Bytes = Uint8Array | string;

const decode = (content: Bytes) =>
  typeof content === "string" ? content : new TextDecoder().decode(content);

const refuse = (message: string): never => {
  throw new Error(`NATIVE_PROOF_SDK_RESOLUTION: ${message}`);
};

type RecordedEdge = {
  importer: string;
  specifier: string;
  resolved: { path?: string; outside?: boolean; virtual?: boolean; bare?: string } | null;
  external: boolean;
  inGraph: boolean;
};

type ResolutionRecord = {
  nonce: string;
  environment: string;
  consumer: "client" | "server" | null;
  outDir: string;
  vite: string | null;
  edges: RecordedEdge[];
  unparsed: string[];
  sdkModules: string[];
};

function readRecord(path: string, content: Bytes): ResolutionRecord {
  let value: unknown;
  try {
    value = JSON.parse(decode(content));
  } catch {
    return refuse(`${path} is not JSON. Rebuild the Theme.`);
  }
  const record = value as Partial<ResolutionRecord> | null;
  if (
    !record ||
    typeof record !== "object" ||
    typeof record.nonce !== "string" ||
    typeof record.environment !== "string" ||
    typeof record.outDir !== "string" ||
    !Array.isArray(record.edges) ||
    !Array.isArray(record.unparsed) ||
    !Array.isArray(record.sdkModules)
  ) {
    return refuse(`${path} is not a resolution record. Rebuild the Theme.`);
  }
  for (const edge of record.edges as unknown[]) {
    const e = edge as Partial<RecordedEdge> | null;
    if (
      !e ||
      typeof e.importer !== "string" ||
      typeof e.specifier !== "string" ||
      typeof e.external !== "boolean" ||
      typeof e.inGraph !== "boolean" ||
      (e.resolved !== null && typeof e.resolved !== "object")
    ) {
      return refuse(`${path} holds an edge Morph cannot read. Rebuild the Theme.`);
    }
  }
  return record as ResolutionRecord;
}

function describeResolution(edge: RecordedEdge): string {
  const at = edge.resolved;
  if (!at) return "nothing";
  if (at.path) return at.path;
  if (at.outside) return "a file outside the Theme";
  if (at.virtual) return "a module a plugin made";
  return `"${at.bare ?? "an unknown id"}"`;
}

/** `import`, `export … from`, `import(…)` or `require(…)` of a reserved name. */
const RUNTIME_IMPORT =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*|\brequire\s*\(\s*)(["'`])(@morph\/sdk(?:\/[^"'`]*)?)\1/;

const isScript = (path: string) => /\.(?:m|c)?js$/.test(path);

/**
 * Morph's own check of a native Start build's SDK resolution, outside the
 * build's process: the records the plugin wrote, held against the bytes
 * the build wrote. Throws `NATIVE_PROOF_SDK_RESOLUTION` on any doubt.
 *
 * - `outputs`: the workspace after the build (records, and the environments'
 *   output directories);
 * - `directories`: where the collector found the Worker and its assets
 *   (`collectNativeCloudflareArtifact`), and the artifact files it moved;
 * - `nonce`: this pass's own.
 */
export function verifyNativeStartSdkProof(args: {
  outputs: ReadonlyMap<string, Bytes>;
  directories: Readonly<{ server: string; client: string }>;
  artifactFiles: ReadonlyMap<string, Bytes>;
  nonce: string;
  /** The Vite config file, for messages. */
  configFile?: string;
}): NativeBuildProof["sdk"] & { vite: string } {
  const config = args.configFile ?? "vite.config.ts";
  if (!args.nonce) {
    return refuse("this build pass has no nonce, so its records cannot be told from a stale copy.");
  }

  const records: Array<{ path: string; record: ResolutionRecord }> = [];
  for (const [path, content] of args.outputs) {
    if (!path.startsWith(`${NATIVE_RESOLUTION_RECORD_DIR}/`)) continue;
    if (!RECORD_FILE.test(path)) {
      return refuse(`the build wrote ${path}, which is not one of Morph's records. A Vite plugin writes into .morph/; remove it.`);
    }
    records.push({ path, record: readRecord(path, content) });
  }

  // The artifact's two parts, and the environment that built each.
  const outputOf = (record: ResolutionRecord): "client" | "server" | null =>
    record.outDir === args.directories.server
      ? "server"
      : record.outDir === args.directories.client
        ? "client"
        : null;
  for (const part of ["server", "client"] as const) {
    if (!records.some(({ record }) => outputOf(record) === part)) {
      return refuse(
        `the build wrote no SDK resolution record for its ${part === "server" ? "Worker" : "browser"} output. A Vite plugin may stop Morph's ${NATIVE_RESOLUTION_PLUGIN_NAME} plugin from running; remove it, or rebuild the Theme.`,
      );
    }
  }

  const environments: NativeSdkProofEnvironment[] = [];
  let vite: string | null = null;
  for (const { path, record } of records.sort((a, b) =>
    a.record.environment.localeCompare(b.record.environment),
  )) {
    if (record.nonce !== args.nonce) {
      return refuse(`${path} was not written by this build. Rebuild the Theme.`);
    }
    if (record.vite !== THEME_START_TOOLCHAIN.vite) {
      return refuse(
        `the ${record.environment} environment ran Vite ${record.vite ?? "(unknown)"}, not the certified ${THEME_START_TOOLCHAIN.vite}. Use vite ${THEME_START_TOOLCHAIN.vite}.`,
      );
    }
    vite = record.vite;
    if (record.unparsed.length > 0) {
      return refuse(
        `${record.unparsed[0]} names @morph/sdk in code Morph cannot read in the ${record.environment} environment. A Vite plugin rewrites it; remove that plugin.`,
      );
    }
    const output = outputOf(record);
    const specifiers = new Set<string>();
    for (const edge of record.edges) {
      const expected = THEME_MORPH_SDK_MODULES[edge.specifier];
      const where = `${edge.importer}, ${record.environment} environment`;
      if (!expected) {
        return refuse(
          `${where} imports "${edge.specifier}", which is not a Morph SDK entry. Import @morph/sdk or @morph/sdk/start.`,
        );
      }
      if (edge.external) {
        return refuse(
          `${config} leaves "${edge.specifier}" external (${where}), so the Worker or the browser would load it at run time instead of Morph's copy. Remove the external, alias or plugin that does this.`,
        );
      }
      if (!edge.resolved || edge.resolved.path !== expected || !edge.inGraph) {
        return refuse(
          `${config} changes where ${edge.specifier} resolves (${where}: resolved to ${describeResolution(edge)}${edge.resolved?.path === expected ? ", which is not the module the build bundled" : ""}). Remove the alias or plugin.`,
        );
      }
      specifiers.add(edge.specifier);
    }

    const sentinelFiles: string[] = [];
    if (output) {
      const prefix = output === "server" ? "runtime/server/" : "runtime/client/";
      const scripts = [...args.artifactFiles].filter(
        ([path]) => path.startsWith(prefix) && isScript(path),
      );
      for (const specifier of [...specifiers].sort()) {
        const sentinel = nativeSdkSentinel(args.nonce, specifier);
        const carrying = scripts.find(([, content]) =>
          decode(content).includes(sentinel),
        );
        if (!carrying) {
          return refuse(
            `the ${record.environment} environment imports ${specifier}, but Morph's copy of it is not in the code the build wrote for it. A Vite plugin replaces or drops that module; remove it.`,
          );
        }
        if (!sentinelFiles.includes(carrying[0])) sentinelFiles.push(carrying[0]);
      }
    }
    environments.push({
      name: record.environment,
      output: output ?? (record.consumer === "client" ? "client" : "server"),
      specifiers: [...specifiers].sort(),
      edges: record.edges.length,
      sentinelFiles: sentinelFiles.sort(),
    });
  }

  // Without the record: no deployed script may still import a reserved name.
  for (const [path, content] of args.artifactFiles) {
    if (!isScript(path)) continue;
    const match = RUNTIME_IMPORT.exec(decode(content));
    if (match) {
      return refuse(
        `${path} still imports "${match[2]}" at run time: ${config} leaves the Morph SDK external. Remove the external, alias or plugin that does this.`,
      );
    }
  }

  return { environments, vite: vite ?? THEME_START_TOOLCHAIN.vite };
}

/**
 * The static HTML among an artifact's served assets, and where each came
 * from: a file of the project's `public/` directory, an SPA shell, or a page
 * the build prerendered.
 */
export function nativeHtmlAssets(args: {
  artifactFiles: ReadonlyMap<string, Bytes>;
  outputs: ReadonlyMap<string, Bytes>;
}): NativeBuildProof["html"] {
  const html: Array<{ path: string; source: NativeHtmlSource }> = [];
  for (const path of [...args.artifactFiles.keys()].sort()) {
    if (!path.startsWith("runtime/client/") || !/\.html?$/i.test(path)) continue;
    const served = path.slice("runtime/client/".length);
    const source: NativeHtmlSource = args.outputs.has(`public/${served}`)
      ? "public"
      : /(^|\/)_shell\.html$/.test(served)
        ? "spa-shell"
        : "prerender";
    html.push({ path, source });
  }
  return html;
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

/**
 * A `nativeProof` value read back from a manifest, or null when it is not
 * one this Morph wrote. Shape only: the evidence was checked when the build
 * was collected; the deployment plan checks it names files the manifest
 * holds.
 */
export function readNativeBuildProof(value: unknown): NativeBuildProof | null {
  if (!isRecordObject(value)) return null;
  if (value.version !== NATIVE_PROOF_VERSION) return null;
  const sdk = value.sdk;
  const toolchain = value.toolchain;
  if (!isRecordObject(sdk) || !Array.isArray(sdk.environments)) return null;
  if (!isRecordObject(toolchain) || typeof toolchain.vite !== "string") return null;
  if (!Array.isArray(value.html)) return null;
  const environments: NativeSdkProofEnvironment[] = [];
  for (const entry of sdk.environments) {
    if (
      !isRecordObject(entry) ||
      typeof entry.name !== "string" ||
      (entry.output !== "client" && entry.output !== "server") ||
      !isStringArray(entry.specifiers) ||
      typeof entry.edges !== "number" ||
      !isStringArray(entry.sentinelFiles)
    ) {
      return null;
    }
    environments.push({
      name: entry.name,
      output: entry.output,
      specifiers: [...entry.specifiers],
      edges: entry.edges,
      sentinelFiles: [...entry.sentinelFiles],
    });
  }
  if (!environments.some((entry) => entry.output === "server")) return null;
  if (!environments.some((entry) => entry.output === "client")) return null;
  const html: Array<{ path: string; source: NativeHtmlSource }> = [];
  for (const entry of value.html) {
    if (
      !isRecordObject(entry) ||
      typeof entry.path !== "string" ||
      (entry.source !== "public" &&
        entry.source !== "spa-shell" &&
        entry.source !== "prerender")
    ) {
      return null;
    }
    html.push({ path: entry.path, source: entry.source });
  }
  return {
    version: NATIVE_PROOF_VERSION,
    sdk: { environments },
    toolchain: { vite: toolchain.vite },
    html,
  };
}
