import { createHash } from "node:crypto";
import { parse } from "@babel/parser";
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
 * can change where `@morph/sdk` resolves, leave it external, serve other
 * bytes for Morph's copy, or rewrite the code that imports it. Publishing
 * such a build would ship a Theme whose content reads, or whose hide gates,
 * are not Morph's. The proof is decided by Morph, outside the build, from
 * three kinds of evidence:
 *
 * 1. **Records**, written by Morph's `morph:native-resolution` plugin in each
 *    Vite environment:
 *    - `resolution.<env>.json` at `buildEnd`: every module of the final
 *      module graph, and every import of a reserved name in the code each
 *      module was left with after every transform, per specifier and per
 *      import kind (static, dynamic), with what it resolves to and whether
 *      that is one of the module's actual edges of that kind;
 *    - `bundle.<env>.json` at `generateBundle` (last plugin, last hook
 *      order): every emitted chunk, its modules and the sha256 of its code.
 *    They are written in the build's own process, beside the author's
 *    plugins, so they prove nothing alone.
 * 2. **The bytes the build wrote**, which Morph reads itself: each recorded
 *    chunk must be on disk with the recorded hash (a later `writeBundle`
 *    rewrite is caught); the import graph between chunks is read from those
 *    bytes with a JavaScript parser, not taken from the record; and each
 *    reserved SDK entry carries a sentinel statement with the build pass's
 *    random nonce (`morph-sdk:start:<nonce>:<entry>`), so no Theme file can
 *    carry it beforehand.
 * 3. **The Theme's own sources**, which Morph parses: a source module of the
 *    Worker's graph that imports a reserved name as a value must still have
 *    that import, of that kind, in its final code (a transform that rewrites
 *    the import away is caught).
 *
 * From these: every edge resolves to exactly its entry's file; the chunk of
 * each importing module, when it is reachable from an entry chunk, reaches
 * the chunk that holds that file through imports read from the bytes; that
 * chunk carries the entry's sentinel; and no reachable chunk imports a
 * reserved name at run time.
 *
 * Author plugins run in the same process, so this is integrity evidence
 * against a build that silently stops reading content through Morph, not a
 * security boundary (design section 1); isolation stays the Sandbox and Core.
 * What it cannot see is listed in the PR body ("Remaining bypasses"), among
 * them:
 * - call-site rewrites that keep the graph: a plugin that leaves an SDK
 *   import in place but changes what the code does with it, including a
 *   Worker source with two imports of one name of which only one is
 *   rewritten (the source check compares per file, kind and name);
 * - imports computed at run time from values it cannot see. In the Worker
 *   such an import of a bare SDK name has nothing to load; in a browser a
 *   page's import map could resolve one, so a Theme that ships an import
 *   map naming `@morph/sdk` is outside what this proves.
 *
 * The verified result is the artifact's `nativeProof` (manifest `runtime`);
 * a native artifact without it is refused before a production publish
 * changes anything (`nativeProductionAdmission`).
 */

/**
 * The proof's version. It joins the native Start compiler identity
 * (tanstack-start.framework.ts), so a build made before the proof, or under
 * another version of the plugin or the checks below, is never reused as one
 * that carries it. Change it whenever `nativeResolutionPluginSource`, the
 * sentinel statement or `verifyNativeStartSdkProof` changes after a release
 * (native-start-proof.test.ts pins the plugin's hash).
 */
export const NATIVE_PROOF_VERSION = "np-1";

/** Where the plugin writes its records. */
export const NATIVE_RESOLUTION_RECORD_DIR = ".morph/records";
const RECORD_FILE =
  /^\.morph\/records\/(resolution|bundle)\.([A-Za-z0-9_-]+)\.json$/;
/** The adapter-option check's own records (tanstack-start-native-wrapper.ts). */
const ADAPTER_RECORDS = new Set([
  ".morph/records/adapter-option-refused.json",
  ".morph/records/adapter-calls.json",
]);

/** The plugin module the wrapper imports, beside it in `.morph/`. */
export const NATIVE_RESOLUTION_PLUGIN_PATH = ".morph/native-resolution.mjs";

/** The `morph:native-resolution` plugin's name, as Vite reports it. */
export const NATIVE_RESOLUTION_PLUGIN_NAME = "morph:native-resolution";

/** Each reserved name's short key in its sentinel. */
function sentinelKey(specifier: string): string {
  const key =
    specifier === "@morph/sdk" ? "sdk" : specifier.slice("@morph/sdk/".length);
  return key.replace(/[^A-Za-z0-9-]/g, "-");
}

/** The string Morph looks for in the chunk that holds `specifier`'s file. */
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
 * - `buildEnd` (once per environment, after every module is loaded and
 *   transformed): the graph's modules, and each import of a reserved name in
 *   each module's final code, per specifier and kind. A dynamic import whose
 *   specifier is a template literal without expressions counts as that
 *   string (Rollup treats it so); one computed from expressions that starts
 *   with `@morph/sdk` is recorded as computed, and refused. Static edges are
 *   resolved with `this.resolve` and must be among the module's static
 *   imports; dynamic edges must be among its dynamic imports, which is where
 *   a `resolveDynamicImport` redirect shows.
 * - `generateBundle`, as the last hook of the last plugin: every chunk, its
 *   modules and the sha256 of its code.
 */
export function nativeResolutionPluginSource(): string {
  return String.raw`// Written by Morph for this build (native-start-proof.ts).
import { createHash } from "node:crypto";
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

function specifierOf(node) {
  if (!node) return { kind: "none" };
  if (node.type === "Literal" && typeof node.value === "string") return { kind: "string", value: node.value };
  if (node.type === "TemplateLiteral") {
    if (node.expressions.length === 0) return { kind: "string", value: node.quasis.map((q) => q.value.cooked).join("") };
    const head = node.quasis[0] && node.quasis[0].value.cooked;
    return { kind: "computed", head: typeof head === "string" ? head : "" };
  }
  return { kind: "computed", head: "" };
}

function imports(ast) {
  const found = [];
  const computed = [];
  walk(ast, (node) => {
    let source = null;
    let kind = "static";
    if (
      node.type === "ImportDeclaration" ||
      node.type === "ExportAllDeclaration" ||
      (node.type === "ExportNamedDeclaration" && node.source)
    ) {
      source = specifierOf(node.source);
    } else if (node.type === "ImportExpression") {
      source = specifierOf(node.source);
      kind = "dynamic";
    } else if (
      node.type === "CallExpression" &&
      node.callee &&
      node.callee.type === "Identifier" &&
      node.callee.name === "require" &&
      node.arguments.length === 1
    ) {
      source = specifierOf(node.arguments[0]);
      kind = "dynamic";
    }
    if (!source) return;
    if (source.kind === "string" && RESERVED.test(source.value)) found.push({ specifier: source.value, kind });
    if (source.kind === "computed" && source.head.startsWith(MENTION)) computed.push(kind);
  });
  // Every occurrence is kept: a dynamic import resolves per occurrence, so
  // two imports of one name can resolve apart.
  return { found, computed };
}

// Each Vite Web Worker bundle (a "?worker" import) is its own Rollup build,
// with the plugins of worker.plugins; the wrapper adds this plugin there
// with scope "worker", and each such build records under its own number.
let workerBuilds = 0;

export default function morphNativeResolution({ workspaceRoot, nonce, scope }) {
  const root = fs.realpathSync(workspaceRoot);
  const worker = scope === "worker" ? ++workerBuilds : 0;
  const where = (id) => {
    const raw = String(id).replace(/\\/g, "/");
    const query = raw.includes("?") ? raw.slice(raw.indexOf("?")) : "";
    const file = raw.split("?")[0];
    if (file.startsWith("\0")) return { virtual: true };
    if (!path.isAbsolute(file)) return { bare: file };
    let real = file;
    try {
      real = fs.realpathSync(file);
    } catch {}
    const relative = path.relative(root, real).split(path.sep).join("/");
    if (relative.startsWith("..") || path.isAbsolute(relative)) return { outside: true };
    return { path: relative, query };
  };
  const key = (id) => {
    const at = where(id);
    return at.path ? at.path + at.query : null;
  };
  const describe = (environment) => {
    const name = environment && typeof environment.name === "string" ? environment.name : "default";
    const config = environment && environment.config ? environment.config : {};
    const rel = (value) => path.relative(root, path.resolve(config.root || root, value)).split(path.sep).join("/");
    return {
      name,
      consumer: config.consumer === "client" ? "client" : config.consumer === "server" ? "server" : null,
      outDir: rel((config.build && config.build.outDir) || "dist"),
      publicDir: typeof config.publicDir === "string" && config.publicDir ? rel(config.publicDir) : null,
    };
  };
  const write = (kind, name, record) => {
    const dir = path.join(root, ".morph", "records");
    fs.mkdirSync(dir, { recursive: true });
    const safe = name.replace(/[^A-Za-z0-9_-]/g, "_");
    fs.writeFileSync(path.join(dir, kind + "." + safe + ".json"), JSON.stringify(record, null, 2));
  };
  return {
    name: "morph:native-resolution",
    enforce: "post",
    async buildEnd(error) {
      if (error) return;
      const environment = describe(this.environment);
      const edges = [];
      const unparsed = [];
      const computed = [];
      const modules = new Set();
      for (const id of this.getModuleIds()) {
        const info = this.getModuleInfo(id);
        if (!info || info.isExternal) continue;
        const moduleKey = key(id);
        if (moduleKey) modules.add(moduleKey);
        if (typeof info.code !== "string" || !info.code.includes(MENTION)) continue;
        const file = String(id).split("?")[0].replace(/\\/g, "/");
        if (file.includes("/node_modules/")) continue;
        const importer = moduleKey ?? (where(id).virtual ? "<virtual>" : "<outside>");
        let ast = info.ast;
        if (!ast) {
          try {
            ast = this.parse(info.code);
          } catch {
            unparsed.push(importer);
            continue;
          }
        }
        const statics = new Set(info.importedIds || []);
        // One entry per dynamic import occurrence, as resolved for that
        // occurrence (a resolveDynamicImport hook resolves each one).
        const dynamics = [...(info.dynamicallyImportedIds || [])];
        const found = imports(ast);
        for (const kind of found.computed) computed.push({ importer, kind });
        const used = new Map();
        for (const { specifier, kind } of found.found) {
          const resolved = await this.resolve(specifier, id);
          let inGraph = false;
          if (resolved && kind === "static") inGraph = statics.has(resolved.id);
          if (resolved && kind === "dynamic") {
            // The n-th dynamic occurrence of this name needs an n-th
            // dynamic edge to what it resolves to.
            const seen = (used.get(resolved.id) || 0) + 1;
            used.set(resolved.id, seen);
            inGraph = dynamics.filter((dynamicId) => dynamicId === resolved.id).length >= seen;
          }
          edges.push({
            importer,
            specifier,
            kind,
            resolved: resolved ? where(resolved.id) : null,
            external: Boolean(resolved && resolved.external),
            inGraph,
          });
        }
      }
      write("resolution", worker ? environment.name + "__worker" + worker : environment.name, {
        worker,
        nonce,
        environment: environment.name,
        consumer: environment.consumer,
        outDir: environment.outDir,
        publicDir: environment.publicDir,
        vite: (this.meta && this.meta.viteVersion) || null,
        rollup: (this.meta && this.meta.rollupVersion) || null,
        edges,
        unparsed,
        computed,
        modules: [...modules].sort(),
      });
    },
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        const environment = describe(this.environment);
        const chunks = [];
        for (const output of Object.values(bundle)) {
          if (output.type !== "chunk") continue;
          chunks.push({
            fileName: output.fileName,
            isEntry: Boolean(output.isEntry),
            isDynamicEntry: Boolean(output.isDynamicEntry),
            modules: (output.moduleIds || []).map(key).filter(Boolean).sort(),
            sha256: createHash("sha256").update(output.code).digest("hex"),
          });
        }
        chunks.sort((a, b) => (a.fileName < b.fileName ? -1 : 1));
        write("bundle", worker ? environment.name + "__worker" + worker : environment.name, {
          worker,
          nonce,
          environment: environment.name,
          outDir: environment.outDir,
          chunks,
        });
      },
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
  /** Reserved names imported in it by code the deployed entries reach. */
  specifiers: readonly string[];
  /** Import edges of those names, each resolved to Morph's copy. */
  edges: number;
  /** Artifact files (JavaScript) that hold each imported entry's sentinel. */
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
   * production publish refuses any (`nativeProductionAdmission`).
   */
  html: readonly Readonly<{ path: string; source: NativeHtmlSource }>[];
}>;

export type NativeHtmlSource = "public" | "spa-shell" | "prerender";

type Bytes = Uint8Array | string;

const decode = (content: Bytes) =>
  typeof content === "string" ? content : new TextDecoder().decode(content);

const sha256 = (content: Bytes) =>
  createHash("sha256").update(content).digest("hex");

const refuse = (message: string): never => {
  throw new Error(`NATIVE_PROOF_SDK_RESOLUTION: ${message}`);
};

type Resolution = {
  path?: string;
  query?: string;
  outside?: boolean;
  virtual?: boolean;
  bare?: string;
};

type RecordedEdge = {
  importer: string;
  specifier: string;
  kind: "static" | "dynamic";
  resolved: Resolution | null;
  external: boolean;
  inGraph: boolean;
};

type ResolutionRecord = {
  nonce: string;
  environment: string;
  /** 0 for the environment itself; n for its n-th Web Worker bundle. */
  worker: number;
  consumer: "client" | "server" | null;
  outDir: string;
  publicDir: string | null;
  vite: string | null;
  edges: RecordedEdge[];
  unparsed: string[];
  computed: Array<{ importer: string; kind: string }>;
  modules: string[];
};

type BundleChunk = {
  fileName: string;
  isEntry: boolean;
  isDynamicEntry: boolean;
  modules: string[];
  sha256: string;
};

type BundleRecord = {
  nonce: string;
  environment: string;
  worker: number;
  outDir: string;
  chunks: BundleChunk[];
};

/** A record's Web Worker number: absent is the environment itself. */
function workerOf(path: string, value: unknown): number {
  if (value === undefined) return 0;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  return refuse(`${path} names a Web Worker bundle Morph cannot read. Rebuild the Theme.`);
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(path: string, content: Bytes): unknown {
  try {
    return JSON.parse(decode(content));
  } catch {
    return refuse(`${path} is not JSON. Rebuild the Theme.`);
  }
}

function readResolutionRecord(path: string, content: Bytes): ResolutionRecord {
  const record = parseJson(path, content);
  if (
    !isRecordObject(record) ||
    typeof record.nonce !== "string" ||
    typeof record.environment !== "string" ||
    typeof record.outDir !== "string" ||
    !(record.publicDir === null || typeof record.publicDir === "string") ||
    !Array.isArray(record.edges) ||
    !isStringArray(record.unparsed) ||
    !Array.isArray(record.computed) ||
    !isStringArray(record.modules)
  ) {
    return refuse(`${path} is not a resolution record. Rebuild the Theme.`);
  }
  for (const edge of record.edges as unknown[]) {
    if (
      !isRecordObject(edge) ||
      typeof edge.importer !== "string" ||
      typeof edge.specifier !== "string" ||
      (edge.kind !== "static" && edge.kind !== "dynamic") ||
      typeof edge.external !== "boolean" ||
      typeof edge.inGraph !== "boolean" ||
      !(edge.resolved === null || isRecordObject(edge.resolved))
    ) {
      return refuse(`${path} holds an edge Morph cannot read. Rebuild the Theme.`);
    }
  }
  return {
    ...(record as unknown as ResolutionRecord),
    worker: workerOf(path, record.worker),
  };
}

function readBundleRecord(path: string, content: Bytes): BundleRecord {
  const record = parseJson(path, content);
  if (
    !isRecordObject(record) ||
    typeof record.nonce !== "string" ||
    typeof record.environment !== "string" ||
    typeof record.outDir !== "string" ||
    !Array.isArray(record.chunks)
  ) {
    return refuse(`${path} is not a bundle record. Rebuild the Theme.`);
  }
  for (const chunk of record.chunks as unknown[]) {
    if (
      !isRecordObject(chunk) ||
      typeof chunk.fileName !== "string" ||
      typeof chunk.isEntry !== "boolean" ||
      typeof chunk.isDynamicEntry !== "boolean" ||
      !isStringArray(chunk.modules) ||
      typeof chunk.sha256 !== "string"
    ) {
      return refuse(`${path} holds a chunk Morph cannot read. Rebuild the Theme.`);
    }
  }
  return {
    ...(record as unknown as BundleRecord),
    worker: workerOf(path, record.worker),
  };
}

function describeResolution(edge: RecordedEdge): string {
  const at = edge.resolved;
  if (!at) return "nothing";
  if (at.path) return at.path;
  if (at.outside) return "a file outside the Theme";
  if (at.virtual) return "a module a plugin made";
  return `"${at.bare ?? "an unknown id"}"`;
}

const stripQuery = (key: string) => key.split("?")[0]!;

/** `a/b/../c` → `a/c`; null when it climbs out. */
function normalize(path: string): string | null {
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

const dirname = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

type ChunkImports = {
  static: string[];
  dynamic: string[];
  /** Reserved names imported at run time (computed ones as `<computed>`). */
  reserved: string[];
  /**
   * The sentinel strings of the chunk's sentinel statements, matched as the
   * exact statement `Reflect.set(globalThis, Symbol.for("morph.sdk.sentinel"),
   * "<sentinel>")`, not a substring anywhere in the code.
   */
  sentinels: string[];
};

const isIdentifier = (node: unknown, name: string) =>
  isRecordObject(node) && node.type === "Identifier" && node.name === name;

const isMember = (node: unknown, object: string, property: string) =>
  isRecordObject(node) &&
  node.type === "MemberExpression" &&
  node.computed !== true &&
  isIdentifier(node.object, object) &&
  isIdentifier(node.property, property);

/** The sentinel a call node sets, when it is Morph's sentinel statement. */
function sentinelOf(node: Record<string, unknown>): string | null {
  if (node.type !== "CallExpression" || !isMember(node.callee, "Reflect", "set")) {
    return null;
  }
  const args = node.arguments as unknown[];
  if (!Array.isArray(args) || args.length !== 3) return null;
  const [target, key, value] = args;
  if (!isIdentifier(target, "globalThis")) return null;
  if (
    !isRecordObject(key) ||
    key.type !== "CallExpression" ||
    !isMember(key.callee, "Symbol", "for") ||
    !Array.isArray(key.arguments) ||
    key.arguments.length !== 1 ||
    !isRecordObject(key.arguments[0]) ||
    key.arguments[0].type !== "StringLiteral" ||
    key.arguments[0].value !== "morph.sdk.sentinel"
  ) {
    return null;
  }
  return isRecordObject(value) &&
    value.type === "StringLiteral" &&
    typeof value.value === "string"
    ? value.value
    : null;
}

/**
 * The imports a chunk's code makes, read from its bytes with a parser:
 * static (`import`, `export … from`) and dynamic (`import()` with a string or
 * expression-free template). Relative specifiers are resolved against the
 * chunk's own path; others are kept for the reserved-name check.
 */
function chunkImports(
  path: string,
  code: string,
  root: string,
  /**
   * `module`: bundler output, always an ES module. `script-or-module`: a
   * file copied from the public directory, which a page may load as a
   * classic script (sloppy mode: duplicate parameters, `with`, octal
   * literals) or as a module; it is read as a module when it parses as
   * one, else as a classic script, where only `import()` can load code.
   */
  mode: "module" | "script-or-module" = "module",
): ChunkImports {
  const parseAs = (sourceType: "module" | "script") =>
    parse(code, {
      sourceType,
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      createImportExpressions: true,
    });
  let ast: ReturnType<typeof parse>;
  try {
    ast = parseAs("module");
  } catch {
    if (mode === "module") {
      return refuse(
        `${path} is not JavaScript Morph can read. A Vite plugin rewrites the build's output; remove it.`,
      );
    }
    try {
      ast = parseAs("script");
    } catch {
      return refuse(
        `${path}, copied from the public directory, is not JavaScript Morph can read as a script or a module. Fix the file or remove it.`,
      );
    }
  }
  const result: ChunkImports = {
    static: [],
    dynamic: [],
    reserved: [],
    sentinels: [],
  };
  const literal = (node: unknown): string | null => {
    if (
      isRecordObject(node) &&
      node.type === "TemplateLiteral" &&
      Array.isArray(node.expressions) &&
      node.expressions.length > 0
    ) {
      // A specifier computed at run time that starts with a reserved name.
      const head = (node.quasis as Array<{ value: { cooked: string } }>)[0]
        ?.value.cooked;
      if (typeof head === "string" && head.startsWith("@morph/sdk")) {
        result.reserved.push("<computed>");
      }
      return null;
    }
    if (!isRecordObject(node)) return null;
    if (node.type === "StringLiteral" && typeof node.value === "string") {
      return node.value;
    }
    if (
      node.type === "TemplateLiteral" &&
      Array.isArray(node.expressions) &&
      node.expressions.length === 0 &&
      Array.isArray(node.quasis)
    ) {
      return (node.quasis as Array<{ value: { cooked: string } }>)
        .map((quasi) => quasi.value.cooked)
        .join("");
    }
    return null;
  };
  const add = (specifier: string | null, kind: "static" | "dynamic") => {
    if (specifier === null) return;
    if (/^@morph\/sdk(?:\/.*)?$/.test(specifier)) {
      result.reserved.push(specifier);
      return;
    }
    if (!specifier.startsWith(".") && !specifier.startsWith("/")) return;
    const target = specifier.startsWith("/")
      ? normalize(`${root}${specifier}`)
      : normalize(`${dirname(path)}/${specifier}`);
    if (target !== null) result[kind].push(target);
  };
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (!isRecordObject(node)) return;
    const type = node.type;
    if (
      type === "ImportDeclaration" ||
      type === "ExportAllDeclaration" ||
      (type === "ExportNamedDeclaration" && node.source)
    ) {
      add(literal(node.source), "static");
    } else if (type === "ImportExpression") {
      add(literal(node.source), "dynamic");
    } else if (
      type === "CallExpression" &&
      isRecordObject(node.callee) &&
      (node.callee.type === "Import" ||
        (node.callee.type === "Identifier" && node.callee.name === "require")) &&
      Array.isArray(node.arguments) &&
      node.arguments.length >= 1
    ) {
      add(literal(node.arguments[0]), "dynamic");
    }
    const sentinel = sentinelOf(node);
    if (sentinel !== null) result.sentinels.push(sentinel);
    for (const [key, value] of Object.entries(node)) {
      if (
        key === "loc" ||
        key === "start" ||
        key === "end" ||
        key === "extra" ||
        key === "comments" ||
        key === "leadingComments" ||
        key === "trailingComments" ||
        key === "innerComments"
      ) {
        continue;
      }
      if (value && typeof value === "object") visit(value);
    }
  };
  visit(ast.program);
  return result;
}

/** What `sourceSdkImports` reports for a computed reserved specifier. */
export const COMPUTED_SPECIFIER = "<computed>";

const TYPE_ONLY_NODES = new Set([
  "TSTypeAnnotation",
  "TSTypeParameterInstantiation",
  "TSTypeParameterDeclaration",
  "TSInterfaceDeclaration",
  "TSTypeAliasDeclaration",
  "TSDeclareFunction",
  "TSModuleDeclaration",
  "TSEnumDeclaration",
  "TSTypeReference",
  "TSTypeQuery",
  "TSImportType",
  "TSExpressionWithTypeArguments",
]);

/**
 * The imports of a reserved name a Theme source module makes that its
 * compiled code keeps: side-effect imports, re-exports, dynamic imports,
 * and imports with at least one binding used as a value. TypeScript (and
 * esbuild, which compiles it) drops a `.ts`/`.tsx` import whose bindings are
 * only used as types; JavaScript keeps every import. Null when the file
 * cannot be parsed.
 */
export function sourceSdkImports(
  path: string,
  code: string,
): Array<{ specifier: string; kind: "static" | "dynamic" }> | null {
  const typescript = /\.(?:m|c)?tsx?$/.test(path);
  const jsx = /\.(?:t|j)sx$/.test(path);
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(code, {
      sourceType: "module",
      createImportExpressions: true,
      plugins: [
        ...(typescript ? (["typescript"] as const) : []),
        ...(jsx ? (["jsx"] as const) : []),
        "decorators-legacy",
      ],
    });
  } catch {
    return null;
  }
  const reserved = (value: unknown) =>
    typeof value === "string" && /^@morph\/sdk(?:\/.*)?$/.test(value);
  const found = new Map<string, { specifier: string; kind: "static" | "dynamic" }>();
  const keep = (specifier: string, kind: "static" | "dynamic") =>
    found.set(`${kind} ${specifier}`, { specifier, kind });

  // Bindings of value imports whose use decides whether the import stays.
  const pending = new Map<string, string>();
  for (const statement of ast.program.body) {
    const node = statement as unknown as Record<string, unknown>;
    const source = isRecordObject(node.source) ? node.source.value : null;
    if (node.type === "ImportDeclaration" && reserved(source)) {
      if (node.importKind === "type") continue;
      const specifiers = (node.specifiers as Array<Record<string, unknown>>) ?? [];
      if (specifiers.length === 0) {
        keep(source as string, "static");
        continue;
      }
      const values = specifiers.filter((s) => s.importKind !== "type");
      if (!typescript) {
        if (values.length > 0) keep(source as string, "static");
        continue;
      }
      for (const value of values) {
        const local = isRecordObject(value.local) ? value.local.name : null;
        if (typeof local === "string") pending.set(local, source as string);
      }
    } else if (
      (node.type === "ExportAllDeclaration" ||
        node.type === "ExportNamedDeclaration") &&
      reserved(source) &&
      node.exportKind !== "type"
    ) {
      // `export { type A, type B } from` is erased like `export type {…}`;
      // one value re-export keeps the statement.
      const specifiers = (node.specifiers as Array<Record<string, unknown>>) ?? [];
      if (
        node.type === "ExportNamedDeclaration" &&
        typescript &&
        specifiers.length > 0 &&
        specifiers.every((specifier) => specifier.exportKind === "type")
      ) {
        continue;
      }
      keep(source as string, "static");
    }
  }

  // A dynamic import's specifier as the post-transform check reads it: a
  // string, an expression-free template (that string), or a template
  // computed from expressions, which counts when it starts with a reserved
  // name and is refused.
  const dynamicSpecifier = (argument: unknown) => {
    if (!isRecordObject(argument)) return;
    if (argument.type === "StringLiteral" && reserved(argument.value)) {
      keep(argument.value as string, "dynamic");
      return;
    }
    if (argument.type === "TemplateLiteral" && Array.isArray(argument.quasis)) {
      const quasis = argument.quasis as Array<{ value: { cooked: string } }>;
      const expressions = argument.expressions as unknown[];
      if (expressions.length === 0) {
        const text = quasis.map((quasi) => quasi.value.cooked).join("");
        if (reserved(text)) keep(text, "dynamic");
      } else if ((quasis[0]?.value.cooked ?? "").startsWith("@morph/sdk")) {
        keep(COMPUTED_SPECIFIER, "dynamic");
      }
    }
  };

  const visit = (node: unknown, parentKey: string | null, parent: Record<string, unknown> | null): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child, parentKey, parent);
      return;
    }
    if (!isRecordObject(node)) return;
    const type = node.type as string;
    if (TYPE_ONLY_NODES.has(type)) return;
    if (type === "ImportDeclaration") return;
    if (type === "ImportExpression") dynamicSpecifier(node.source);
    if (
      type === "CallExpression" &&
      isRecordObject(node.callee) &&
      node.callee.type === "Import" &&
      Array.isArray(node.arguments)
    ) {
      dynamicSpecifier(node.arguments[0]);
    }
    if ((type === "Identifier" || type === "JSXIdentifier") && pending.has(node.name as string)) {
      const isPropertyKey =
        parent &&
        ((parentKey === "property" &&
          (parent.type === "MemberExpression" ||
            parent.type === "OptionalMemberExpression" ||
            parent.type === "JSXMemberExpression") &&
          parent.computed !== true) ||
          (parentKey === "key" &&
            (parent.type === "ObjectProperty" ||
              parent.type === "ObjectMethod" ||
              parent.type === "ClassProperty" ||
              parent.type === "ClassMethod") &&
            parent.computed !== true &&
            parent.shorthand !== true) ||
          (parentKey === "name" && parent.type === "JSXAttribute"));
      if (!isPropertyKey) {
        keep(pending.get(node.name as string)!, "static");
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (
        key === "loc" ||
        key === "start" ||
        key === "end" ||
        key === "extra" ||
        key === "leadingComments" ||
        key === "trailingComments" ||
        key === "innerComments" ||
        key === "typeAnnotation" ||
        key === "returnType" ||
        key === "typeParameters"
      ) {
        continue;
      }
      if (value && typeof value === "object") visit(value, key, node);
    }
  };
  visit(ast.program, null, null);
  return [...found.values()];
}


/**
 * Morph's own check of a native Start build's SDK resolution, outside the
 * build's process: the records the plugin wrote, held against the bytes and
 * the sources the build left. Throws `NATIVE_PROOF_SDK_RESOLUTION` on any
 * doubt.
 *
 * - `outputs`: the workspace after the build (records, sources, and the
 *   environments' output directories);
 * - `directories`: where the collector found the Worker and its assets;
 * - `nonce`: this pass's own.
 */
export function verifyNativeStartSdkProof(args: {
  outputs: ReadonlyMap<string, Bytes>;
  directories: Readonly<{ server: string; client: string }>;
  nonce: string;
  /** The Vite config file, for messages. */
  configFile?: string;
  /** The Worker entry the artifact deploys, workspace-relative. */
  workerEntry?: string;
  /**
   * The build's prepared inputs (the Theme's sources after the file-language
   * passes, as the plan wrote them), by path: what the Worker-graph source
   * check reads, so a file changed or removed during the build does not
   * change the answer.
   */
  sources: ReadonlyMap<string, string>;
}): NativeBuildProof["sdk"] & { vite: string; publicDir: string | null } {
  const config = args.configFile ?? "vite.config.ts";
  if (!args.nonce) {
    return refuse(
      "this build pass has no nonce, so its records cannot be told from a stale copy.",
    );
  }

  const resolutions = new Map<string, { path: string; record: ResolutionRecord }>();
  const bundles = new Map<string, { path: string; record: BundleRecord }>();
  // One record of each kind per Vite environment and per Web Worker bundle
  // built inside it.
  const keyOf = (record: { environment: string; worker: number }) =>
    `${record.environment}#${record.worker}`;
  for (const [path, content] of args.outputs) {
    if (!path.startsWith(`${NATIVE_RESOLUTION_RECORD_DIR}/`)) continue;
    if (ADAPTER_RECORDS.has(path)) continue;
    const match = RECORD_FILE.exec(path);
    if (!match) {
      return refuse(
        `the build wrote ${path}, which is not one of Morph's records. A Vite plugin writes into .morph/; remove it.`,
      );
    }
    if (match[1] === "resolution") {
      const record = readResolutionRecord(path, content);
      resolutions.set(keyOf(record), { path, record });
    } else {
      const record = readBundleRecord(path, content);
      bundles.set(keyOf(record), { path, record });
    }
  }

  const outputOf = (outDir: string): "client" | "server" | null =>
    outDir === args.directories.server
      ? "server"
      : outDir === args.directories.client
        ? "client"
        : null;
  // A Web Worker bundle ships inside the browser output (Vite emits it as an
  // asset of the client build), whatever its own build calls its directory.
  const partOf = (record: { outDir: string; worker: number }) =>
    record.worker > 0 ? "client" : outputOf(record.outDir);
  for (const part of ["server", "client"] as const) {
    const named = part === "server" ? "Worker" : "browser";
    const main = (record: { outDir: string; worker: number }) =>
      record.worker === 0 && outputOf(record.outDir) === part;
    if (![...resolutions.values()].some(({ record }) => main(record))) {
      return refuse(
        `the build wrote no SDK resolution record for its ${named} output. A Vite plugin may stop Morph's ${NATIVE_RESOLUTION_PLUGIN_NAME} plugin from running; remove it, or rebuild the Theme.`,
      );
    }
    if (![...bundles.values()].some(({ record }) => main(record))) {
      return refuse(
        `the build wrote no bundle record for its ${named} output. A Vite plugin may stop Morph's ${NATIVE_RESOLUTION_PLUGIN_NAME} plugin from running; remove it, or rebuild the Theme.`,
      );
    }
  }

  type Part = {
    name: string;
    outDir: string;
    publicDir: string | null;
    edges: RecordedEdge[];
    chunks: BundleChunk[];
  };
  const parts = new Map<"server" | "client", Part>();
  let vite: string | null = null;
  let publicDir: string | null = null;
  for (const key of [...resolutions.keys()].sort()) {
    const { path, record } = resolutions.get(key)!;
    const name =
      record.worker > 0
        ? `${record.environment} Web Worker ${record.worker}`
        : record.environment;
    const output = partOf(record);
    if (record.nonce !== args.nonce) {
      return refuse(`${path} was not written by this build. Rebuild the Theme.`);
    }
    if (record.vite !== THEME_START_TOOLCHAIN.vite) {
      return refuse(
        `the ${name} environment ran Vite ${record.vite ?? "(unknown)"}, not the certified ${THEME_START_TOOLCHAIN.vite}. Use vite ${THEME_START_TOOLCHAIN.vite}.`,
      );
    }
    vite = record.vite;
    if (output === "client" && record.worker === 0) publicDir = record.publicDir;
    if (record.unparsed.length > 0) {
      return refuse(
        `${record.unparsed[0]} names @morph/sdk in code Morph cannot read in the ${name} environment. A Vite plugin rewrites it; remove that plugin.`,
      );
    }
    if (record.computed.length > 0) {
      return refuse(
        `${record.computed[0]!.importer} imports @morph/sdk through a specifier computed at run time in the ${name} environment. Import @morph/sdk or @morph/sdk/start by name.`,
      );
    }
    for (const edge of record.edges) {
      const expected = THEME_MORPH_SDK_MODULES[edge.specifier];
      const where = `${stripQuery(edge.importer)}, ${name} environment${edge.kind === "dynamic" ? ", dynamic import" : ""}`;
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
    }

    // The Worker's graph: a Theme source that imports a reserved name as a
    // value still does so in its final code. Read from the build's own
    // prepared inputs, never from the workspace the build could change.
    if (output === "server" && record.worker === 0) {
      const refused = checkWorkerSources({
        record,
        name,
        sources: args.sources,
        outputs: args.outputs,
      });
      if (refused) return refuse(refused);
    }

    const bundle = resolutions.has(key) ? bundles.get(key) : undefined;
    if (!bundle) {
      if (output) {
        return refuse(
          `the build wrote no bundle record for its ${name} environment. Rebuild the Theme.`,
        );
      }
      continue;
    }
    if (bundle.record.nonce !== args.nonce) {
      return refuse(`${bundle.path} was not written by this build. Rebuild the Theme.`);
    }
    if (record.worker === 0 && bundle.record.outDir !== record.outDir) {
      return refuse(`${bundle.path} names another output directory. Rebuild the Theme.`);
    }
    const partFor = (target: "server" | "client") =>
      parts.get(target) ?? {
        name: "",
        outDir: target === "server" ? args.directories.server : args.directories.client,
        publicDir: null,
        edges: [],
        chunks: [],
      };
    if (record.worker === 0) {
      if (!output) continue;
      const part = partFor(output);
      part.name = record.environment;
      part.publicDir = record.publicDir;
      part.edges.push(...record.edges);
      part.chunks.push(...bundle.record.chunks);
      parts.set(output, part);
      continue;
    }
    // Vite builds a Web Worker bundle once and emits the same bytes as an
    // asset of every environment that imports it: the bundle belongs to
    // each output that holds its files (their hashes are checked there).
    const holding = (["server", "client"] as const).filter((target) => {
      const outDir =
        target === "server" ? args.directories.server : args.directories.client;
      return bundle.record.chunks.every((chunk) =>
        args.outputs.has(`${outDir}/${chunk.fileName}`),
      );
    });
    if (holding.length === 0) {
      return refuse(
        `the ${name} bundle was emitted, but no output holds its files. A Vite plugin changes the output after it is generated; remove it.`,
      );
    }
    for (const target of holding) {
      const part = partFor(target);
      part.edges.push(...record.edges);
      part.chunks.push(...bundle.record.chunks);
      parts.set(target, part);
    }
  }
  // A bundle record no resolution record pairs with: a plugin wrote it.
  for (const [key, bundle] of bundles) {
    if (!resolutions.has(key)) {
      return refuse(`${bundle.path} has no resolution record beside it. Rebuild the Theme.`);
    }
  }

  const environments: NativeSdkProofEnvironment[] = [];
  for (const output of ["client", "server"] as const) {
    const part = parts.get(output)!;
    const proven = proveBundle({
      name: part.name,
      outDir: part.outDir,
      edges: part.edges,
      chunks: part.chunks,
      outputs: args.outputs,
      nonce: args.nonce,
      config,
      artifactPrefix: output === "server" ? "runtime/server" : "runtime/client",
      ...(output === "server"
        ? { entryFile: args.workerEntry }
        : { publicDir: part.publicDir }),
    });
    environments.push({
      name: part.name,
      output,
      specifiers: proven.specifiers,
      edges: proven.edges,
      sentinelFiles: proven.sentinelFiles,
    });
  }

  return {
    environments,
    vite: vite ?? THEME_START_TOOLCHAIN.vite,
    publicDir,
  };
}

/**
 * Files a build writes into its own graph that are not the Theme's: the
 * route tree Start's router plugin generates. Read from the workspace, the
 * only place they exist.
 */
const BUILD_GENERATED_SOURCES = new Set(["src/routeTree.gen.ts"]);

/**
 * The Worker-graph source check: every Theme module of the Worker's final
 * graph is one of the build's prepared inputs (or a file the build itself
 * generates), and every SDK import those inputs make as a value is still in
 * the module's final code, per specifier and kind. Null when it holds.
 */
function checkWorkerSources(args: {
  record: ResolutionRecord;
  name: string;
  sources: ReadonlyMap<string, string>;
  outputs: ReadonlyMap<string, Bytes>;
}): string | null {
  const kept = new Set(
    args.record.edges.map(
      (edge) => `${stripQuery(edge.importer)} ${edge.kind} ${edge.specifier}`,
    ),
  );
  // A module counts when the graph loads the file's own code: with no query,
  // or a query that still compiles the file (a router's code-split part).
  // Vite's `?worker`, `?url`, `?raw` and `?inline` load something else (a
  // stub that starts the worker, a URL, the text), not the file's imports.
  const otherContent =
    /[?&](?:worker|sharedworker|worker_file|url|raw|inline)(?:[=&]|$)/;
  const modules = new Set(
    args.record.modules
      .filter((module) => !otherContent.test(module))
      .map(stripQuery)
      .filter(
        (module) =>
          !module.startsWith(".morph/") && /\.(?:m|c)?(?:j|t)sx?$/.test(module),
      ),
  );
  for (const module of [...modules].sort()) {
    let text = args.sources.get(module);
    if (text === undefined) {
      const generated = BUILD_GENERATED_SOURCES.has(module)
        ? args.outputs.get(module)
        : undefined;
      if (generated === undefined) {
        return `${module} is in the ${args.name} environment's graph but is not one of the files the build was given. A Vite plugin writes it during the build; remove it.`;
      }
      text = decode(generated);
    }
    if (!text.includes("@morph/sdk")) continue;
    const imported = sourceSdkImports(module, text);
    if (imported === null) {
      return `${module} imports @morph/sdk, but Morph cannot read the file to check it. Simplify its syntax.`;
    }
    for (const { specifier, kind } of imported) {
      if (specifier === COMPUTED_SPECIFIER) {
        return `${module} imports @morph/sdk through a specifier computed at run time. Import @morph/sdk or @morph/sdk/start by name.`;
      }
      if (!kept.has(`${module} ${kind} ${specifier}`)) {
        return `${module} imports ${specifier}${kind === "dynamic" ? " dynamically" : ""}, but the code the ${args.name} environment built from it does not. A Vite plugin rewrites that import; remove it.`;
      }
    }
  }
  return null;
}

/**
 * One deployed output's SDK reachability, from its bytes: every recorded
 * chunk on disk with its recorded hash; the import graph between chunks
 * parsed from them; and for each edge whose importer is in a chunk the
 * entries reach, the chunk holding the entry's file reachable from it (static
 * imports for a static edge) and carrying the entry's sentinel. A dynamic
 * import the bundler removed as dead leaves the entry's file in no chunk and
 * is not required.
 */
function proveBundle(args: {
  name: string;
  outDir: string;
  edges: readonly RecordedEdge[];
  chunks: readonly BundleChunk[];
  outputs: ReadonlyMap<string, Bytes>;
  nonce: string;
  config: string;
  artifactPrefix: string;
  /** The deployed Worker's entry, workspace-relative (the Worker output only). */
  entryFile?: string;
  /** The public directory, workspace-relative (the browser output only). */
  publicDir?: string | null;
}): { specifiers: string[]; sentinelFiles: string[]; edges: number } {
  const byFile = new Map<string, BundleChunk>();
  const code = new Map<string, string>();
  for (const chunk of args.chunks) {
    const file = normalize(`${args.outDir}/${chunk.fileName}`);
    if (file === null || !file.startsWith(`${args.outDir}/`)) {
      return refuse(`the ${args.name} bundle record names ${chunk.fileName}, outside its output. Rebuild the Theme.`);
    }
    const content = args.outputs.get(file);
    if (content === undefined) {
      return refuse(
        `the ${args.name} environment emitted ${chunk.fileName}, but the build did not write it. A Vite plugin changes the output after it is generated; remove it.`,
      );
    }
    if (sha256(content) !== chunk.sha256) {
      return refuse(
        `${chunk.fileName} in the ${args.name} output is not the code the bundler emitted. A Vite plugin rewrites the output after it is generated; remove it.`,
      );
    }
    byFile.set(file, chunk);
    code.set(file, decode(content));
  }
  // Coverage: every script this output ships is a chunk the bundler emitted
  // and Morph verified. The only exception is a browser file copied
  // unchanged from the public directory, which is the author's own static
  // file, not built code; it is still scanned for SDK imports below.
  const isScript = (path: string) => /\.(?:m|c)?js$/i.test(path);
  const publicCopies = new Map<string, string>();
  for (const [path, content] of args.outputs) {
    if (!path.startsWith(`${args.outDir}/`) || !isScript(path)) continue;
    if (byFile.has(path)) continue;
    const served = path.slice(args.outDir.length + 1);
    const original =
      args.publicDir != null
        ? args.outputs.get(`${args.publicDir}/${served}`)
        : undefined;
    if (original !== undefined && sha256(original) === sha256(content)) {
      publicCopies.set(path, decode(content));
      continue;
    }
    return refuse(
      `${args.artifactPrefix}/${served} is not code the bundler emitted for the ${args.name} environment, so Morph cannot vouch for it. A Vite plugin writes it into the output; remove it.`,
    );
  }

  const graph = new Map<string, ChunkImports>();
  for (const [file, text] of code) graph.set(file, chunkImports(file, text, args.outDir));
  for (const [file, text] of publicCopies) {
    graph.set(file, chunkImports(file, text, args.outDir, "script-or-module"));
  }

  // The Worker is deployed from its entry: that file must be a verified
  // chunk the bundler marked as an entry.
  if (args.entryFile !== undefined) {
    const entry = byFile.get(args.entryFile);
    if (!entry || !entry.isEntry) {
      return refuse(
        `the Worker's entry ${args.artifactPrefix}/${args.entryFile.slice(args.outDir.length + 1)} is not an entry chunk the bundler emitted. Rebuild the Theme.`,
      );
    }
  }
  const reach = (from: readonly string[], kinds: "static" | "all") => {
    const seen = new Set<string>();
    const queue = [...from];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const imports = graph.get(file);
      if (!imports) continue;
      queue.push(...imports.static);
      if (kinds === "all") queue.push(...imports.dynamic);
    }
    return seen;
  };
  // Every shipped script counts as able to run: a Worker can import any
  // module it was deployed with, a browser any file it is served. So every
  // one is checked, not only those an entry reaches.
  const reachable = new Set(graph.keys());
  // Relative imports must stay inside what was verified.
  for (const [file, imports] of graph) {
    for (const target of [...imports.static, ...imports.dynamic]) {
      if (isScript(target) && !graph.has(target)) {
        return refuse(
          `${args.artifactPrefix}/${file.slice(args.outDir.length + 1)} imports ${target.startsWith(`${args.outDir}/`) ? `${args.artifactPrefix}/${target.slice(args.outDir.length + 1)}` : target}, which is not code the bundler emitted for the ${args.name} environment. A Vite plugin changes the output; remove it.`,
        );
      }
    }
  }

  // Without the record: no shipped script imports a reserved name at run
  // time (an SDK left external, or a computed SDK specifier).
  for (const file of [...reachable].sort()) {
    const reserved = graph.get(file)?.reserved ?? [];
    if (reserved.length > 0) {
      return refuse(
        `${args.artifactPrefix}/${file.slice(args.outDir.length + 1)} still imports "${reserved[0]}" at run time: ${args.config} leaves the Morph SDK external. Remove the external, alias or plugin that does this.`,
      );
    }
  }

  const chunksOf = (module: string) =>
    [...byFile].filter(([, chunk]) => chunk.modules.includes(module)).map(([file]) => file);

  const specifiers = new Set<string>();
  const sentinelFiles = new Set<string>();
  let counted = 0;
  for (const edge of args.edges) {
    const expected = THEME_MORPH_SDK_MODULES[edge.specifier]!;
    const importerChunks = chunksOf(edge.importer).filter((file) => reachable.has(file));
    // The importing module is in no chunk the deployed entries reach: its
    // code does not run.
    if (importerChunks.length === 0) continue;
    const targetChunks = chunksOf(expected).filter((file) => reachable.has(file));
    if (targetChunks.length === 0) {
      if (edge.kind === "dynamic") continue;
      return refuse(
        `${stripQuery(edge.importer)} imports ${edge.specifier} in the ${args.name} environment, but Morph's copy of it is in no chunk the deployed code reaches. A Vite plugin drops or replaces that module; remove it.`,
      );
    }
    const sentinel = nativeSdkSentinel(args.nonce, edge.specifier);
    for (const importer of importerChunks) {
      const reached = reach([importer], edge.kind === "static" ? "static" : "all");
      const carrying = targetChunks.filter(
        (file) =>
          reached.has(file) && graph.get(file)!.sentinels.includes(sentinel),
      );
      if (carrying.length === 0) {
        return refuse(
          `the ${args.name} environment imports ${edge.specifier} (${stripQuery(edge.importer)}), but the code the build wrote for it does not reach Morph's copy of it. A Vite plugin replaces or drops that module, or redirects the import; remove it.`,
        );
      }
      for (const file of carrying) {
        sentinelFiles.add(`${args.artifactPrefix}/${file.slice(args.outDir.length + 1)}`);
      }
    }
    specifiers.add(edge.specifier);
    counted += 1;
  }
  return {
    specifiers: [...specifiers].sort(),
    sentinelFiles: [...sentinelFiles].sort(),
    edges: counted,
  };
}

/**
 * The static HTML among an artifact's served assets, and where each came
 * from: a file of the project's public directory (`publicDir`, as the
 * client environment resolved it), an SPA shell, or a page the build
 * prerendered.
 */
export function nativeHtmlAssets(args: {
  artifactFiles: ReadonlyMap<string, Bytes>;
  outputs: ReadonlyMap<string, Bytes>;
  publicDir?: string | null;
}): NativeBuildProof["html"] {
  const publicDir = args.publicDir === undefined ? "public" : args.publicDir;
  const html: Array<{ path: string; source: NativeHtmlSource }> = [];
  for (const path of [...args.artifactFiles.keys()].sort()) {
    if (!path.startsWith("runtime/client/") || !/\.html?$/i.test(path)) continue;
    const served = path.slice("runtime/client/".length);
    const source: NativeHtmlSource =
      publicDir !== null && args.outputs.has(`${publicDir}/${served}`)
        ? "public"
        : /(^|\/)_shell\.html?$/i.test(served)
          ? "spa-shell"
          : "prerender";
    html.push({ path, source });
  }
  return html;
}

const SENTINEL_FILE = /^runtime\/(server|client)\/.+\.(?:m|c)?js$/;

/**
 * A `nativeProof` value read back from a manifest, or null when it is not a
 * consistent one this Morph writes: its version, the certified Vite, a
 * Worker and a browser part, and for each part that imports the SDK, at
 * least as many edges as entries and a JavaScript sentinel file of that
 * part per entry. Whether the files exist is the caller's (the artifact
 * store and the production admission hold the manifest's file list).
 */
export function readNativeBuildProof(value: unknown): NativeBuildProof | null {
  if (!isRecordObject(value)) return null;
  if (value.version !== NATIVE_PROOF_VERSION) return null;
  const sdk = value.sdk;
  const toolchain = value.toolchain;
  if (!isRecordObject(sdk) || !Array.isArray(sdk.environments)) return null;
  if (
    !isRecordObject(toolchain) ||
    toolchain.vite !== THEME_START_TOOLCHAIN.vite
  ) {
    return null;
  }
  if (!Array.isArray(value.html)) return null;
  const environments: NativeSdkProofEnvironment[] = [];
  for (const entry of sdk.environments) {
    if (
      !isRecordObject(entry) ||
      typeof entry.name !== "string" ||
      (entry.output !== "client" && entry.output !== "server") ||
      !isStringArray(entry.specifiers) ||
      typeof entry.edges !== "number" ||
      !Number.isInteger(entry.edges) ||
      entry.edges < 0 ||
      !isStringArray(entry.sentinelFiles)
    ) {
      return null;
    }
    if (entry.specifiers.some((specifier) => !THEME_MORPH_SDK_MODULES[specifier])) {
      return null;
    }
    if (entry.edges < entry.specifiers.length) return null;
    // Edges without the names they import, or names without edges.
    if ((entry.edges > 0) !== (entry.specifiers.length > 0)) return null;
    if (entry.specifiers.length > 0 && entry.sentinelFiles.length === 0) {
      return null;
    }
    if (entry.specifiers.length === 0 && entry.sentinelFiles.length > 0) {
      return null;
    }
    const part = entry.output;
    if (
      entry.sentinelFiles.some((file) => {
        const match = SENTINEL_FILE.exec(file);
        return !match || match[1] !== part;
      })
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
  if (environments.filter((entry) => entry.output === "server").length !== 1) {
    return null;
  }
  if (environments.filter((entry) => entry.output === "client").length !== 1) {
    return null;
  }
  const html: Array<{ path: string; source: NativeHtmlSource }> = [];
  for (const entry of value.html) {
    if (
      !isRecordObject(entry) ||
      typeof entry.path !== "string" ||
      !/^runtime\/client\/.+\.html?$/i.test(entry.path) ||
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
    toolchain: { vite: toolchain.vite as string },
    html,
  };
}

/** The codes a native production admission refuses with. */
export type NativeAdmissionCode =
  | "NATIVE_PROOF_MISSING"
  | "NATIVE_HTML_ASSET_UNAVAILABLE";

const HTML_SOURCE_LABEL = {
  public: "copied from the public directory",
  "spa-shell": "an SPA shell",
  prerender: "prerendered",
} as const;

/**
 * Step 1's production admission of a native Start artifact (design section
 * 1, "Step 1 is SSR only"; section 6): a consistent proof whose sentinel
 * files the artifact holds, and no static HTML among the assets it would
 * serve. Assets answer before the Worker, and before Core, so an HTML file
 * there would be served for its path whatever the release and its content
 * say.
 *
 * One function, called before a publish writes anything
 * (storefront-theme.dal.ts) and again where the production deployment is
 * planned, including rollback (theme-worker-deployment-plan.ts), so a
 * historical native artifact without a proof is refused by both with the
 * same code. Only for an artifact whose immutable `compilerId` is the native
 * Start build's; callers check that (`isNativeWranglerContractArtifact`).
 * Build Preview is not production and is not held to it.
 */
export function nativeProductionAdmission(manifest: {
  runtime?: { nativeProof?: unknown; clientAssetsDirectory?: string } | null;
  files?: ReadonlyArray<{ path: string }> | null;
}): { code: NativeAdmissionCode; message: string } | null {
  const proof = readNativeBuildProof(manifest.runtime?.nativeProof);
  const paths = new Set(
    (Array.isArray(manifest.files) ? manifest.files : []).map((file) =>
      file.path.replace(/\\/g, "/"),
    ),
  );
  const unbacked = proof?.sdk.environments
    .flatMap((environment) => environment.sentinelFiles)
    .find((path) => !paths.has(path));
  if (!proof || unbacked) {
    return {
      code: "NATIVE_PROOF_MISSING",
      message: `NATIVE_PROOF_MISSING: This native build carries no ${
        proof ? "complete " : ""
      }SDK resolution proof${unbacked ? ` (it names ${unbacked}, which the artifact does not hold)` : ""}, so Morph cannot tell its Theme reads content through Morph's SDK. Rebuild the Theme.`,
    };
  }
  const clientDirectory = (
    typeof manifest.runtime?.clientAssetsDirectory === "string"
      ? manifest.runtime.clientAssetsDirectory
      : "runtime/client"
  )
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
  // From the files themselves, not only the proof's list: the proof names
  // the source when it knows it.
  const html = [...paths]
    .filter(
      (path) =>
        clientDirectory !== "" &&
        path.startsWith(`${clientDirectory}/`) &&
        /\.html?$/i.test(path),
    )
    .sort();
  if (html.length > 0) {
    const first = html[0]!;
    const source = proof.html.find((entry) => entry.path === first)?.source;
    return {
      code: "NATIVE_HTML_ASSET_UNAVAILABLE",
      message: `NATIVE_HTML_ASSET_UNAVAILABLE: The build would serve ${first}${
        source ? ` (${HTML_SOURCE_LABEL[source]})` : ""
      } as /${first.slice(clientDirectory.length + 1)}${
        html.length > 1 ? `, and ${html.length - 1} more HTML file(s)` : ""
      }. Static HTML is not published yet: the asset layer would answer it before the Theme Worker and Core. Remove the prerender setting, the SPA shell or the file.`,
    };
  }
  return null;
}
