/**
 * What `built-production-check.mjs` has to refuse, and what it lets through.
 *
 * Run by `node --test` from `pnpm build`, not vitest: vitest collects `src/**`
 * and `packages/*\/src/**` only, so a test beside this script would never run.
 *
 * Each fixture is a scratch `dist/server` holding the two chunks shaped as the
 * build emits them today, differing from the passing one by one change.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  checkBuiltProduction,
  extractFunctionDefinitions,
  nameOrRenamed,
} from "./built-production-check.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratchRoot = mkdtempSync(join(tmpdir(), "morph-built-production-test-"));
after(() => rmSync(scratchRoot, { recursive: true, force: true }));

const UNREPLACED = 'process.env.NODE_ENV==="production"';

/** `isProductionEnvironment`'s chunk as emitted today, last operand swappable. */
const moduleChunk = (lastOperand, exportClause = "isProductionEnvironment as i", prelude = "") =>
  `${prelude}function isProductionEnvironment(env){const candidate=env;return candidate?.CF_PAGES==="1"||candidate?.ENVIRONMENT==="production"||${lastOperand}}class LocalStorefrontDomainProvider{kind="local";async attach(hostname){return\`local-dev:\${hostname}\`}}export{${exportClause},LocalStorefrontDomainProvider as L};\n`;

/** `isProductionRuntime` as emitted today, under `name`. */
const runtimeFn = (lastOperand, name = "isProductionRuntime") =>
  `function ${name}(env2){return env2.CF_PAGES==="1"||env2.ENVIRONMENT==="production"||${lastOperand}}`;

/** The Worker entry, which Node cannot import, with `isProductionRuntime` inlined. */
const workerEntry = (lastOperand, { name = "isProductionRuntime", extra = "" } = {}) =>
  `import "cloudflare:workers";const DEFAULT_DEV_ORIGIN="http://localhost:3000";${runtimeFn(lastOperand, name)}function resolvePublicOrigin(options){if(${name}(options.env))return options.configured}${extra}export{resolvePublicOrigin as r};\n`;

const MODULE_FILE = "assets/storefront-domain-provider-LoHcRGpV.js";
const ENTRY_FILE = "assets/worker-entry-Cgup1Ny3.js";
const PASSING = { [MODULE_FILE]: moduleChunk("true"), [ENTRY_FILE]: workerEntry("true") };

/**
 * A copy of the exact name that answers `true`, where a decoy could hide.
 * Single quotes keep the cut decoy compilable, so it really does pass.
 */
const DECOY_IN_STRING = `const embedded='${runtimeFn("true")}';`;
const DECOY_IN_COMMENT = `/* ${runtimeFn("true")} */`;

let cases = 0;
/** A scratch server directory holding `files` (relative name -> contents). */
function server(files) {
  cases += 1;
  const directory = join(scratchRoot, `case-${cases}`);
  mkdirSync(join(directory, "assets"), { recursive: true });
  // dist/ inherits `"type": "module"` from the repository; a scratch dir has to say so.
  writeFileSync(join(directory, "package.json"), '{"type":"module"}\n');
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(directory, name), contents);
  }
  return directory;
}

/** Runs `fn` with NODE_ENV set to `value`, then puts it back. */
async function withNodeEnv(value, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, "NODE_ENV");
  const saved = process.env.NODE_ENV;
  process.env.NODE_ENV = value;
  try {
    return await fn();
  } finally {
    if (had) process.env.NODE_ENV = saved;
    else delete process.env.NODE_ENV;
  }
}

describe("extractFunctionDefinitions", () => {
  it("cuts out every copy, nested braces and $<n> renames included, and marks an unended cut", () => {
    const source =
      "x();function f(a){if(a){return{b:1}}return 2}y();function f$1(c){return 3}function fg(d){}function f(e){";
    assert.deepEqual(extractFunctionDefinitions(source, nameOrRenamed("f")), [
      { name: "f", text: "function f(a){if(a){return{b:1}}return 2}" },
      { name: "f$1", text: "function f$1(c){return 3}" },
      { name: "f", text: null },
    ]);
    assert.deepEqual(extractFunctionDefinitions(source, nameOrRenamed("g")), []);
  });
});

describe("checkBuiltProduction", () => {
  it("passes the predicates the build emits today", async () => {
    const { checked, failures } = await checkBuiltProduction(server(PASSING));
    assert.deepEqual(failures, []);
    assert.deepEqual(checked, [
      `isProductionEnvironment in ${join("assets", "storefront-domain-provider-LoHcRGpV.js")}`,
      `isProductionRuntime in ${join("assets", "worker-entry-Cgup1Ny3.js")}`,
      `isProductionEnvironment exported by ${join("assets", "storefront-domain-provider-LoHcRGpV.js")}`,
    ]);
  });

  it("refuses isProductionEnvironment with NODE_ENV left for runtime, as a copy and as a module", async () => {
    const { failures } = await checkBuiltProduction(
      server({ ...PASSING, [MODULE_FILE]: moduleChunk(UNREPLACED) }),
    );
    assert.ok(failures.some((line) => line.includes("(copy isProductionEnvironment): isProductionEnvironment({}) with NODE_ENV unset returned false")));
    assert.ok(failures.some((line) => line.includes("(module): isProductionEnvironment({}) with NODE_ENV unset returned false")));
    assert.ok(failures.some((line) => line.includes('NODE_ENV "development"')));
    assert.ok(failures.every((line) => !line.includes("isProductionRuntime")));
  });

  it("refuses isProductionRuntime with NODE_ENV left for runtime, though its chunk cannot be imported", async () => {
    const { failures } = await checkBuiltProduction(
      server({ ...PASSING, [ENTRY_FILE]: workerEntry(UNREPLACED) }),
    );
    assert.ok(failures.length > 0);
    assert.ok(failures.every((line) => line.includes("isProductionRuntime(")));
  });

  it("refuses a second, unreplaced copy inlined elsewhere", async () => {
    const { failures } = await checkBuiltProduction(
      server({ ...PASSING, "assets/other-AbC123.js": workerEntry(UNREPLACED) }),
    );
    assert.ok(failures.length > 0);
    assert.ok(failures.every((line) => line.startsWith(join("assets", "other-AbC123.js"))));
  });

  // Review C17 S1: copies renamed by Rollup, and decoys of the exact name.
  it("refuses an extra $1 copy that returns false", async () => {
    const { failures } = await checkBuiltProduction(
      server({
        ...PASSING,
        [ENTRY_FILE]: workerEntry("true", { extra: runtimeFn("false", "isProductionRuntime$1") }),
      }),
    );
    assert.ok(failures.length > 0);
    assert.ok(failures.every((line) => line.includes("(copy isProductionRuntime$1)")));
  });

  for (const [label, decoy] of [
    ["a string", DECOY_IN_STRING],
    ["a comment", DECOY_IN_COMMENT],
  ]) {
    it(`refuses the real copy renamed to $1 beside a passing decoy in ${label}`, async () => {
      const { failures } = await checkBuiltProduction(
        server({
          ...PASSING,
          [ENTRY_FILE]: workerEntry("false", { name: "isProductionRuntime$1", extra: decoy }),
        }),
      );
      assert.ok(failures.length > 0);
      assert.ok(failures.every((line) => line.includes("isProductionRuntime$1")));
    });

    it(`refuses the real copy under an unrelated name beside a passing decoy in ${label}, through its call site`, async () => {
      const { checked, failures } = await checkBuiltProduction(
        server({
          ...PASSING,
          [ENTRY_FILE]: workerEntry("false", { name: "prodRt", extra: decoy }),
        }),
      );
      assert.ok(checked.some((line) => line.startsWith("prodRt (called by resolvePublicOrigin)")));
      assert.ok(failures.length > 0);
      assert.ok(failures.every((line) => line.includes("(called by resolvePublicOrigin)")));
    });
  }

  it("refuses a call site whose callee is not defined in its chunk", async () => {
    const { failures } = await checkBuiltProduction(
      server({
        ...PASSING,
        [ENTRY_FILE]: `${runtimeFn("true")}function resolvePublicOrigin(options){if(i3(options.env))return options.configured}`,
      }),
    );
    assert.ok(failures.some((line) => line.includes("calls i3, which is not defined in the same chunk")));
  });

  // Review C17 N1.
  it("refuses a cut that does not terminate", async () => {
    const { failures } = await checkBuiltProduction(
      server({ ...PASSING, [ENTRY_FILE]: `${workerEntry("true")}function isProductionRuntime(env2){return true` }),
    );
    assert.ok(failures.some((line) => line.includes("isProductionRuntime cut did not terminate")));
  });

  // Review C17 N2: a matching name inside embedded source text is not skipped.
  it("fails closed on a matching name inside embedded TypeScript source", async () => {
    const embedded = JSON.stringify(
      'export function isProductionRuntime(env: PublicOriginEnv): boolean {\n  return env.CF_PAGES === "1" || process.env.NODE_ENV === "production";\n}',
    );
    const { failures } = await checkBuiltProduction(
      server({ ...PASSING, [ENTRY_FILE]: `${workerEntry("true")}const source=${embedded};` }),
    );
    assert.ok(failures.length > 0);
    assert.ok(failures.every((line) => line.includes("did not compile on its own")));
  });

  // Review C17 N3: the module import runs without the shell's NODE_ENV.
  it("imports the module with NODE_ENV cleared, so module-level reads cannot see the shell's production", async () => {
    await withNodeEnv("production", async () => {
      const { failures } = await checkBuiltProduction(
        server({
          ...PASSING,
          [MODULE_FILE]: moduleChunk("IS_PROD", "isProductionEnvironment as i", 'const IS_PROD=process.env.NODE_ENV==="production";'),
        }),
      );
      assert.ok(failures.some((line) => line.includes("(module): isProductionEnvironment({}) with NODE_ENV unset returned false")));
      assert.equal(process.env.NODE_ENV, "production");
    });
  });

  it("is not rescued by NODE_ENV=production on the machine running it, and restores it", async () => {
    await withNodeEnv("production", async () => {
      const { failures } = await checkBuiltProduction(
        server({ [MODULE_FILE]: moduleChunk(UNREPLACED), [ENTRY_FILE]: workerEntry(UNREPLACED) }),
      );
      assert.ok(failures.length > 0);
      assert.equal(process.env.NODE_ENV, "production");
    });
  });

  it("refuses a predicate compiled to false", async () => {
    const { failures } = await checkBuiltProduction(
      server({ ...PASSING, [ENTRY_FILE]: workerEntry("false") }),
    );
    assert.ok(failures.length > 0);
  });

  it("refuses a copy that depends on anything but its argument and process", async () => {
    const { failures } = await checkBuiltProduction(
      server({ ...PASSING, [ENTRY_FILE]: workerEntry('process$1.env.NODE_ENV==="production"') }),
    );
    assert.ok(failures.some((line) => line.includes("threw process$1 is not defined")));
  });

  for (const [label, files, code] of [
    [
      "no isProductionRuntime anywhere",
      { [MODULE_FILE]: moduleChunk("true") },
      "BUILT_PRODUCTION_PREDICATE_NOT_FOUND",
    ],
    [
      "no resolvePublicOrigin call site",
      { [MODULE_FILE]: moduleChunk("true"), [ENTRY_FILE]: runtimeFn("true") },
      "BUILT_PRODUCTION_CALL_SITE_NOT_FOUND",
    ],
    [
      "isProductionEnvironment mangled",
      {
        ...PASSING,
        [MODULE_FILE]: moduleChunk("true").replaceAll("isProductionEnvironment", "a"),
      },
      "BUILT_PRODUCTION_PREDICATE_NOT_FOUND",
    ],
    [
      "no module chunk (inlined elsewhere)",
      { [ENTRY_FILE]: workerEntry("true") + moduleChunk("true").replace(/export\{.*$/s, "") },
      "BUILT_PRODUCTION_CHUNK_NOT_FOUND",
    ],
    [
      "two module chunks",
      { ...PASSING, "assets/storefront-domain-provider-DeF456.js": moduleChunk("true") },
      "BUILT_PRODUCTION_CHUNK_NOT_FOUND",
    ],
    [
      "a module chunk that no longer exports the predicate",
      { ...PASSING, [MODULE_FILE]: moduleChunk("true", "LocalStorefrontDomainProvider as x") },
      "BUILT_PRODUCTION_EXPORT_NOT_FOUND",
    ],
    [
      "a module chunk Node cannot import",
      { ...PASSING, [MODULE_FILE]: `import "cloudflare:workers";\n${moduleChunk("true")}` },
      "BUILT_PRODUCTION_CHUNK_NOT_LOADABLE",
    ],
  ]) {
    it(`fails loudly on ${label}`, async () => {
      await assert.rejects(checkBuiltProduction(server(files)), (error) => {
        assert.equal(error.code, code);
        return true;
      });
    });
  }

  it("fails loudly when the server directory is missing", async () => {
    await assert.rejects(
      checkBuiltProduction(join(scratchRoot, "does-not-exist")),
      (error) => error.code === "BUILT_PRODUCTION_SERVER_NOT_FOUND",
    );
  });
});

describe("check-built-production.mjs", () => {
  const run = (directory) =>
    spawnSync(process.execPath, [join(projectRoot, "scripts", "check-built-production.mjs"), directory], {
      encoding: "utf8",
    });

  it("exits 0 on the passing artifact", () => {
    const result = run(server(PASSING));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\[check-built-production\] OK/);
  });

  it("exits non-zero on the unreplaced NODE_ENV artifact", () => {
    const result = run(server({ ...PASSING, [MODULE_FILE]: moduleChunk(UNREPLACED) }));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /\[check-built-production\] FAIL/);
  });

  it("exits non-zero when there is nothing to check", () => {
    const result = run(server({}));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /BUILT_PRODUCTION_PREDICATE_NOT_FOUND/);
  });
});
