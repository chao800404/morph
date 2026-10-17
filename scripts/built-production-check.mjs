/**
 * Proves, by running them, that the built Worker's production predicates
 * answer "production".
 *
 * `isProductionEnvironment` (src/lib/storefront/service/storefront-domain-provider.ts)
 * and `isProductionRuntime` (src/server/public-origin.ts) are both
 * `CF_PAGES === "1" || ENVIRONMENT === "production" || process.env.NODE_ENV
 * === "production"`. A deployed Worker gets neither binding from wrangler.jsonc,
 * so it counts as production for one reason only: the build replaces
 * `process.env.NODE_ENV` (the Cloudflare Vite plugin defines it from
 * `process.env.NODE_ENV || mode`), and the last operand compiles to `true`. A
 * build run with `NODE_ENV=development` or `--mode development`, or a build
 * change that stops the replacement, ships a Worker that reads
 * `process.env.NODE_ENV` at runtime, finds nothing, and opens every path gated
 * on `!isProductionEnvironment(...)` — the local Theme transport, the Build
 * Preview local origin, the preview sidecar — and lets `isProductionRuntime`
 * trust request origins. Nothing about that build would look wrong.
 *
 * So this runs the emitted code rather than matching its text, in two ways:
 *
 * - Every compiled copy of either function anywhere under `dist/server` is cut
 *   out of its chunk and evaluated on its own. `isProductionRuntime` is inlined
 *   into the Worker entry, which imports `cloudflare:workers` and cannot be
 *   loaded in Node, so this is the only way to run it; it also catches a second
 *   copy the bundler might inline somewhere else. A copy that refers to
 *   anything but its argument and `process` throws, and a throw is a failure.
 * - The chunk that exports `isProductionEnvironment` has no imports, so it is
 *   also imported whole and its export called.
 *
 * Each is asked with `process.env.NODE_ENV` absent and set to non-production
 * values: in the Worker `process.env` holds the bindings and nothing sets
 * `NODE_ENV`, so a predicate that still reads it must not be rescued by
 * whatever the machine running the check happens to have exported.
 *
 * What it does not prove: anything about the Cloudflare runtime itself. It
 * checks this repository's build output, evaluated in Node.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Bindings a deployed Worker can have without either production signal. */
const SIGNAL_FREE_BINDINGS = [
  { label: "{}", env: {} },
  {
    label: "wrangler.jsonc vars",
    env: {
      PUBLIC_URL: "https://example.workers.dev",
      SANDBOX_TRANSPORT: "rpc",
      THEME_PREVIEW_HOSTNAME: "preview.localhost",
    },
  },
  { label: '{ ENVIRONMENT: "development" }', env: { ENVIRONMENT: "development" } },
  { label: '{ CF_PAGES: "0" }', env: { CF_PAGES: "0" } },
  { label: '{ ENVIRONMENT: "", CF_PAGES: "" }', env: { ENVIRONMENT: "", CF_PAGES: "" } },
];

/**
 * The predicates checked. `isProductionRuntime` is typed to take bindings and
 * its one caller passes `env ?? {}`, so it is not asked about `undefined`.
 */
export const TARGETS = [
  {
    name: "isProductionEnvironment",
    bindings: [...SIGNAL_FREE_BINDINGS, { label: "undefined", env: undefined }],
  },
  { name: "isProductionRuntime", bindings: SIGNAL_FREE_BINDINGS },
];

/** Rollup names the chunk after its source module and appends a hash. */
export const MODULE_CHUNK_PATTERN = /^storefront-domain-provider-[\w-]+\.js$/;

/** `undefined` means the variable is deleted for the call. */
export const NODE_ENV_CASES = [undefined, "development", "test"];

export class BuiltProductionCheckError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

function* walkJs(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walkJs(full);
    else if (entry.isFile() && /\.(?:js|mjs|cjs)$/.test(entry.name)) yield full;
  }
}

/**
 * The text of every `function name(...) {...}` in `source`.
 *
 * Braces are counted without regard to strings or comments; the predicates
 * contain neither, and a cut that comes out wrong does not compile, which the
 * caller reports as a failure.
 */
export function extractFunctionDefinitions(source, name) {
  const definitions = [];
  const header = new RegExp(`function\\s+${name}\\s*\\(`, "g");
  for (const match of source.matchAll(header)) {
    const open = source.indexOf("{", source.indexOf(")", match.index));
    if (open === -1) continue;
    let depth = 0;
    for (let index = open; index < source.length; index += 1) {
      const char = source[index];
      if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          definitions.push(source.slice(match.index, index + 1));
          break;
        }
      }
    }
  }
  return definitions;
}

/** The name the chunk exports `name` under (Rollup shortens it, e.g. `as i`). */
export function exportAlias(source, name) {
  for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of match[1].split(",")) {
      const [local, alias] = part.trim().split(/\s+as\s+/);
      if (local === name) return alias ?? local;
    }
  }
  return null;
}

/** Calls `predicate` for every binding and NODE_ENV case; returns what was not `true`. */
function runCases(predicate, target, where) {
  const failures = [];
  const hadNodeEnv = Object.prototype.hasOwnProperty.call(process.env, "NODE_ENV");
  const savedNodeEnv = process.env.NODE_ENV;
  try {
    for (const nodeEnv of NODE_ENV_CASES) {
      if (nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = nodeEnv;
      for (const { label, env } of target.bindings) {
        let result;
        try {
          result = predicate(env);
        } catch (error) {
          result = `threw ${error?.message ?? error}`;
        }
        if (result !== true) {
          failures.push(
            `${where}: ${target.name}(${label}) with NODE_ENV ${
              nodeEnv === undefined ? "unset" : JSON.stringify(nodeEnv)
            } returned ${typeof result === "string" ? result : JSON.stringify(result)}`,
          );
        }
      }
    }
  } finally {
    if (hadNodeEnv) process.env.NODE_ENV = savedNodeEnv;
    else delete process.env.NODE_ENV;
  }
  return failures;
}

/**
 * Runs every check against a built `dist/server` directory.
 *
 * Returns what was checked and every case that did not answer `true`; an empty
 * `failures` list is the only passing result. Throws when there is nothing to
 * check, so a rename or a bundling change cannot make it pass vacuously.
 */
export async function checkBuiltProduction(serverDir) {
  if (!existsSync(serverDir) || !statSync(serverDir).isDirectory()) {
    throw new BuiltProductionCheckError(
      "BUILT_PRODUCTION_SERVER_NOT_FOUND",
      `${serverDir} does not exist. Run this after \`vite build\`.`,
    );
  }

  const files = [...walkJs(serverDir)].map((file) => ({
    file,
    relative: path.relative(serverDir, file),
    source: readFileSync(file, "utf8"),
  }));
  const checked = [];
  const failures = [];

  // 1. Every compiled copy of each predicate, cut out and evaluated alone.
  for (const target of TARGETS) {
    let copies = 0;
    for (const { relative, source } of files) {
      for (const definition of extractFunctionDefinitions(source, target.name)) {
        copies += 1;
        const where = `${relative} (copy)`;
        checked.push(`${target.name} in ${relative}`);
        let predicate;
        try {
          predicate = new Function(`"use strict";${definition}\nreturn ${target.name};`)();
        } catch (error) {
          failures.push(`${where}: ${target.name} did not compile on its own (${error?.message ?? error})`);
          continue;
        }
        failures.push(...runCases(predicate, target, where));
      }
    }
    if (copies === 0) {
      throw new BuiltProductionCheckError(
        "BUILT_PRODUCTION_PREDICATE_NOT_FOUND",
        `no \`function ${target.name}(\` in any .js file under ${serverDir}. It was renamed, mangled or rewritten; update this check rather than letting it pass without checking anything.`,
      );
    }
  }

  // 2. The isProductionEnvironment chunk, imported whole.
  const assetsDir = path.join(serverDir, "assets");
  const chunks = existsSync(assetsDir)
    ? readdirSync(assetsDir).filter((name) => MODULE_CHUNK_PATTERN.test(name))
    : [];
  if (chunks.length !== 1) {
    throw new BuiltProductionCheckError(
      "BUILT_PRODUCTION_CHUNK_NOT_FOUND",
      `expected exactly one chunk matching ${MODULE_CHUNK_PATTERN} in ${assetsDir}, found ${chunks.length}${
        chunks.length > 0 ? ` (${chunks.join(", ")})` : ""
      }. The module was inlined, split or renamed; update this check rather than letting it pass without checking anything.`,
    );
  }
  const chunk = path.join(assetsDir, chunks[0]);
  const target = TARGETS[0];
  const alias = exportAlias(readFileSync(chunk, "utf8"), target.name);
  if (alias === null) {
    throw new BuiltProductionCheckError(
      "BUILT_PRODUCTION_EXPORT_NOT_FOUND",
      `${chunk} does not export ${target.name}. Its name was mangled or the export moved; update this check rather than letting it pass without checking anything.`,
    );
  }
  let module;
  try {
    // The query keeps two checks of different files at one path from sharing
    // Node's module cache.
    const url = pathToFileURL(chunk);
    url.search = `?check=${Date.now()}-${Math.random()}`;
    module = await import(url.href);
  } catch (error) {
    throw new BuiltProductionCheckError(
      "BUILT_PRODUCTION_CHUNK_NOT_LOADABLE",
      `${chunk} could not be imported in Node (${error?.message ?? error}). If it now imports a Worker-only module, this check has to stop importing it and rely on the cut-out copies.`,
    );
  }
  const predicate = module[alias];
  if (typeof predicate !== "function") {
    throw new BuiltProductionCheckError(
      "BUILT_PRODUCTION_EXPORT_NOT_FOUND",
      `${chunk} exports ${target.name} as ${alias}, but that is ${typeof predicate}, not a function.`,
    );
  }
  const relativeChunk = path.relative(serverDir, chunk);
  checked.push(`${target.name} exported by ${relativeChunk}`);
  failures.push(...runCases(predicate, target, `${relativeChunk} (module)`));

  return { checked, failures };
}
