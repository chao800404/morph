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
 * So this runs the emitted code rather than matching its text. Copies are found
 * three ways, and every copy found is checked:
 *
 * - By name: every `function isProductionEnvironment(` /
 *   `function isProductionRuntime(` under `dist/server`, including the
 *   `$1`-style suffixes Rollup adds when it renames a copy to avoid a clash.
 * - By call site: the function `resolvePublicOrigin` actually calls, whatever it
 *   is named. A copy of the right name sitting in a string or a comment cannot
 *   stand in for the real one, because the real one is checked too.
 * - By export: the `storefront-domain-provider-*.js` chunk has no imports, so
 *   it is imported whole and the function it exports as
 *   `isProductionEnvironment` is called.
 *
 * Cut-out copies are evaluated on their own. `isProductionRuntime` is inlined
 * into the Worker entry, which imports `cloudflare:workers` and cannot be
 * loaded in Node, so this is the only way to run it. A copy that refers to
 * anything but its argument and `process` throws, a cut that does not end or
 * does not compile is reported, and all of these are failures. That also means
 * a matching name inside embedded source text (a bundled `.ts` string, say)
 * fails the check rather than being skipped: it fails closed.
 *
 * Each is asked with `process.env.NODE_ENV` absent and set to `"development"`
 * and `"test"`; the module import itself also runs with it absent. In the
 * Worker `process.env` holds the bindings and nothing sets `NODE_ENV`, so the
 * checking shell's value (including `production`) is removed rather than
 * allowed to rescue a predicate that still reads it.
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
 *
 * `callSite` captures the name `resolvePublicOrigin` calls with
 * `options.env`, as emitted today:
 * `function resolvePublicOrigin(options){if(isProductionRuntime(options.env))`.
 */
export const TARGETS = [
  {
    name: "isProductionEnvironment",
    bindings: [...SIGNAL_FREE_BINDINGS, { label: "undefined", env: undefined }],
  },
  {
    name: "isProductionRuntime",
    bindings: SIGNAL_FREE_BINDINGS,
    callSite: {
      caller: "resolvePublicOrigin",
      pattern:
        /function\s+resolvePublicOrigin(?:\$\d+)?\s*\(\s*([\w$]+)\s*\)\s*\{\s*if\s*\(\s*([\w$]+)\s*\(\s*\1\.env\s*\)/g,
    },
  },
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

const escapeRegExp = (text) => text.replace(/[$.*+?^()[\]{}|\\]/g, "\\$&");

/** `name` itself, or `name` with the `$<digits>` suffix Rollup adds on a clash. */
export const nameOrRenamed = (name) => `${escapeRegExp(name)}(?:\\$\\d+)?`;

/**
 * Every `function <name>(...) {...}` in `source` whose name matches
 * `namePattern` (a regular-expression source matched as a whole identifier).
 *
 * Returns `{ name, text }`; `text` is `null` when the braces never close.
 * Braces are counted without regard to strings or comments; the predicates
 * contain neither, and a cut that comes out wrong either does not end or does
 * not compile, both of which the caller reports as failures.
 */
export function extractFunctionDefinitions(source, namePattern) {
  const definitions = [];
  const header = new RegExp(`function\\s+(${namePattern})\\s*\\(`, "g");
  // The name must be followed by `(`, so `foo` never matches `foo$1` or `fooBar`.
  for (const match of source.matchAll(header)) {
    const name = match[1];
    const open = source.indexOf("{", source.indexOf(")", match.index));
    let text = null;
    if (open !== -1) {
      let depth = 0;
      for (let index = open; index < source.length; index += 1) {
        const char = source[index];
        if (char === "{") depth += 1;
        else if (char === "}") {
          depth -= 1;
          if (depth === 0) {
            text = source.slice(match.index, index + 1);
            break;
          }
        }
      }
    }
    definitions.push({ name, text });
  }
  return definitions;
}

/** The name the chunk exports `name` (or a `$<n>` rename of it) under. */
export function exportAlias(source, name) {
  const local = new RegExp(`^${nameOrRenamed(name)}$`);
  for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of match[1].split(",")) {
      const [localName, alias] = part.trim().split(/\s+as\s+/);
      if (local.test(localName)) return alias ?? localName;
    }
  }
  return null;
}

/** Runs `fn` with `process.env.NODE_ENV` as `value` (`undefined` deletes it), then restores it. */
async function withNodeEnv(value, fn) {
  const hadNodeEnv = Object.prototype.hasOwnProperty.call(process.env, "NODE_ENV");
  const savedNodeEnv = process.env.NODE_ENV;
  if (value === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = value;
  try {
    return await fn();
  } finally {
    if (hadNodeEnv) process.env.NODE_ENV = savedNodeEnv;
    else delete process.env.NODE_ENV;
  }
}

/** Calls `predicate` for every binding and NODE_ENV case; returns what was not `true`. */
async function runCases(predicate, target, where) {
  const failures = [];
  for (const nodeEnv of NODE_ENV_CASES) {
    await withNodeEnv(nodeEnv, () => {
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
    });
  }
  return failures;
}

/** Cuts out, compiles and runs one definition; returns its failures. */
async function checkDefinition({ name, text }, target, where) {
  if (text === null) {
    return [`${where}: ${name} cut did not terminate (its braces never close)`];
  }
  let predicate;
  try {
    predicate = new Function(`"use strict";${text}\nreturn ${name};`)();
  } catch (error) {
    return [`${where}: ${name} did not compile on its own (${error?.message ?? error})`];
  }
  return runCases(predicate, target, where);
}

/**
 * Runs every check against a built `dist/server` directory.
 *
 * Returns what was checked and every case that did not answer `true`; an empty
 * `failures` list is the only passing result. Throws when the predicates,
 * their call site, or the module chunk cannot be found, so a rename or a
 * bundling change makes it fail rather than check nothing.
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

  // 1. By name (with `$<n>` renames) and by call site, cut out and run alone.
  for (const target of TARGETS) {
    let copies = 0;
    let callSites = 0;
    for (const { relative, source } of files) {
      const seen = new Set();
      for (const definition of extractFunctionDefinitions(source, nameOrRenamed(target.name))) {
        copies += 1;
        seen.add(definition.name);
        checked.push(`${definition.name} in ${relative}`);
        failures.push(...(await checkDefinition(definition, target, `${relative} (copy ${definition.name})`)));
      }
      if (!target.callSite) continue;
      for (const match of source.matchAll(target.callSite.pattern)) {
        callSites += 1;
        const callee = match[2];
        if (seen.has(callee)) continue;
        seen.add(callee);
        const where = `${relative} (called by ${target.callSite.caller})`;
        const definitions = extractFunctionDefinitions(source, escapeRegExp(callee)).filter(
          (definition) => definition.name === callee,
        );
        if (definitions.length === 0) {
          failures.push(
            `${where}: ${target.callSite.caller} calls ${callee}, which is not defined in the same chunk, so the predicate it relies on was not checked`,
          );
          continue;
        }
        for (const definition of definitions) {
          copies += 1;
          checked.push(`${callee} (called by ${target.callSite.caller}) in ${relative}`);
          failures.push(...(await checkDefinition(definition, target, where)));
        }
      }
    }
    if (copies === 0) {
      throw new BuiltProductionCheckError(
        "BUILT_PRODUCTION_PREDICATE_NOT_FOUND",
        `no \`function ${target.name}(\` in any .js file under ${serverDir}. It was renamed, mangled or rewritten; update this check rather than letting it pass without checking anything.`,
      );
    }
    if (target.callSite && callSites === 0) {
      throw new BuiltProductionCheckError(
        "BUILT_PRODUCTION_CALL_SITE_NOT_FOUND",
        `no call from ${target.callSite.caller} to ${target.name} matched ${target.callSite.pattern} under ${serverDir}. The caller was rewritten; update this check so the copy the Worker actually runs is still located.`,
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
    // Node's module cache. NODE_ENV is absent while the module evaluates, as
    // it is in the Worker, so module-level code cannot read the shell's value.
    const url = pathToFileURL(chunk);
    url.search = `?check=${Date.now()}-${Math.random()}`;
    module = await withNodeEnv(undefined, () => import(url.href));
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
  failures.push(...(await runCases(predicate, target, `${relativeChunk} (module)`)));

  return { checked, failures };
}
