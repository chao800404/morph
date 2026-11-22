// @ts-check
/**
 * The default home and layout Documents each T1 Starter shipped with, in that
 * version's own shape, for the M1 1b harness (starter-upgrade-t1-acceptance).
 *
 * Provisioning today writes the current Starter's Documents, and installing
 * an old Starter's files does not change them, so a case that only swaps files
 * upgrades a Document already in the new shape (`link.href`, `action.href`).
 * These are the Documents an old store really held: for each version, the
 * `createDefaultStorefront*Document()` functions of
 * src/lib/storefront/default-storefront-document.ts at the commit that
 * recorded that Starter version (the starter-history fixture's
 * `sourceCommit`), evaluated as they were, with the relative modules they
 * import read from the same commit. Before v16 there was no layout Document
 * (the shell rendered its own defaults): `layout` is null.
 *
 * Usage (repo root): node e2e/fixtures/starter-history-documents/generate.mjs
 * Rewrites vNN.json for every version listed below; read-only on git.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = join(here, "../../..");
const require = createRequire(join(root, "package.json"));
const esbuild = require("esbuild");
const FILE = "src/lib/storefront/default-storefront-document.ts";

/** @param {...string} args */
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" });

/**
 * Evaluates `path` as it was at `commit`; relative imports come from the
 * same commit, and any other import at run time is refused.
 * @param {string} commit
 * @param {string} path
 * @param {Map<string, { exports: Record<string, any> }>} cache
 * @returns {Record<string, any>}
 */
function load(commit, path, cache = new Map()) {
  const cached = cache.get(path);
  if (cached) return cached.exports;
  const source = git("show", `${commit}:${path}`);
  const { code } = esbuild.transformSync(source, { loader: "ts", format: "cjs" });
  const module = { exports: /** @type {Record<string, any>} */ ({}) };
  cache.set(path, module);
  /** @param {string} specifier */
  const local = (specifier) => {
    if (!specifier.startsWith(".")) {
      throw new Error(`${path} at ${commit} imports ${specifier} at run time`);
    }
    const base = posix.join(posix.dirname(path), specifier);
    return load(commit, base.endsWith(".ts") ? base : `${base}.ts`, cache);
  };
  new Function("module", "exports", "require", code)(module, module.exports, local);
  return module.exports;
}

for (const version of [11, 15, 20, 26, 28]) {
  const fixture = JSON.parse(
    readFileSync(
      join(root, "src/lib/storefront/__fixtures__/starter-history", `v${version}.json`),
      "utf8",
    ),
  );
  const commit = fixture.sourceCommit;
  const source = git("show", `${commit}:${FILE}`);
  const blob = git("rev-parse", `${commit}:${FILE}`).trim();
  const exported = load(commit, FILE);
  if (exported.STOREFRONT_STARTER_TEMPLATE_VERSION !== version) {
    throw new Error(
      `v${version}: ${FILE} at ${commit} records Starter ${exported.STOREFRONT_STARTER_TEMPLATE_VERSION}`,
    );
  }
  const home = exported.createDefaultStorefrontHomeDocument();
  const layout =
    typeof exported.createDefaultStorefrontLayoutDocument === "function"
      ? exported.createDefaultStorefrontLayoutDocument()
      : null;
  const out = {
    starterVersion: version,
    sourceCommit: commit,
    sourceFile: FILE,
    sourceBlob: blob,
    sourceSha256: createHash("sha256").update(source).digest("hex"),
    home,
    layout,
  };
  writeFileSync(join(here, `v${version}.json`), JSON.stringify(out, null, 2) + "\n");
  console.log(`v${version}: ${commit} blob ${blob} layout ${layout ? "yes" : "none"}`);
}
