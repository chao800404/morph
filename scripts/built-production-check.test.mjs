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
} from "./built-production-check.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratchRoot = mkdtempSync(join(tmpdir(), "morph-built-production-test-"));
after(() => rmSync(scratchRoot, { recursive: true, force: true }));

const UNREPLACED = 'process.env.NODE_ENV==="production"';

/** `isProductionEnvironment`'s chunk as emitted today, last operand swappable. */
const moduleChunk = (lastOperand, exportClause = "isProductionEnvironment as i") =>
  `function isProductionEnvironment(env){const candidate=env;return candidate?.CF_PAGES==="1"||candidate?.ENVIRONMENT==="production"||${lastOperand}}class LocalStorefrontDomainProvider{kind="local";async attach(hostname){return\`local-dev:\${hostname}\`}}export{${exportClause},LocalStorefrontDomainProvider as L};\n`;

/** The Worker entry, which Node cannot import, with `isProductionRuntime` inlined. */
const workerEntry = (lastOperand) =>
  `import "cloudflare:workers";const DEFAULT_DEV_ORIGIN="http://localhost:3000";function isProductionRuntime(env2){return env2.CF_PAGES==="1"||env2.ENVIRONMENT==="production"||${lastOperand}}function resolvePublicOrigin(options){if(isProductionRuntime(options.env))return options.configured}export{resolvePublicOrigin as r};\n`;

const MODULE_FILE = "assets/storefront-domain-provider-LoHcRGpV.js";
const ENTRY_FILE = "assets/worker-entry-Cgup1Ny3.js";
const PASSING = { [MODULE_FILE]: moduleChunk("true"), [ENTRY_FILE]: workerEntry("true") };

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
  it("cuts out every copy, nested braces included", () => {
    const source = 'x();function f(a){if(a){return{b:1}}return 2}y();function f(c){return 3}';
    assert.deepEqual(extractFunctionDefinitions(source, "f"), [
      "function f(a){if(a){return{b:1}}return 2}",
      "function f(c){return 3}",
    ]);
    assert.deepEqual(extractFunctionDefinitions(source, "g"), []);
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
    assert.ok(failures.some((line) => line.includes("(copy): isProductionEnvironment({}) with NODE_ENV unset returned false")));
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
