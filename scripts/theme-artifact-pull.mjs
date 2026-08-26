#!/usr/bin/env node
/**
 * Materializes a Theme build artifact from local storage so it can be run.
 *
 * Reads the newest succeeded build (or `--build <id>`) from the local D1
 * database, then copies its artifact objects out of the local R2 blob store
 * into a directory the smoke harness can boot.
 *
 * Local development only: it reads Miniflare's on-disk state directly, which
 * exists solely under `.wrangler/state`.
 *
 * Usage:
 *   node scripts/theme-artifact-pull.mjs [--build <id>] [--out <dir>]
 */
import Database from "better-sqlite3";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const STATE = resolve(process.cwd(), ".wrangler/state/v3");
const D1_DIR = join(STATE, "d1/miniflare-D1DatabaseObject");
const R2_META_DIR = join(STATE, "r2/miniflare-R2BucketObject");
const R2_BLOBS = join(STATE, "r2/morph-r2-global/blobs");

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function onlySqlite(dir, label) {
  if (!existsSync(dir)) {
    console.error(`[pull] no local ${label} state at ${dir} — run the dev server at least once`);
    process.exit(2);
  }
  const files = readdirSync(dir).filter(
    (file) => file.endsWith(".sqlite") && file !== "metadata.sqlite",
  );
  if (files.length === 0) {
    console.error(`[pull] no ${label} database found in ${dir}`);
    process.exit(2);
  }
  return join(dir, files[0]);
}

const outDir = resolve(arg("out", "/tmp/morph-theme-artifact"));
const wantedBuild = arg("build", null);

const d1 = new Database(onlySqlite(D1_DIR, "D1"), { readonly: true });
const build = wantedBuild
  ? d1
      .prepare(
        "SELECT id, artifact_prefix, manifest_json FROM storefront_theme_builds WHERE id = ? AND status = 'succeeded'",
      )
      .get(wantedBuild)
  : d1
      .prepare(
        "SELECT id, artifact_prefix, manifest_json FROM storefront_theme_builds WHERE status = 'succeeded' AND artifact_prefix IS NOT NULL ORDER BY created_at DESC LIMIT 1",
      )
      .get();

if (!build) {
  console.error(
    wantedBuild
      ? `[pull] build ${wantedBuild} is not a succeeded build`
      : "[pull] no succeeded build found — run Build Preview in the editor first",
  );
  process.exit(1);
}

const manifest = JSON.parse(build.manifest_json);
const files = Array.isArray(manifest.files) ? manifest.files : [];
if (files.length === 0) {
  console.error(`[pull] build ${build.id} has an empty manifest`);
  process.exit(1);
}

const r2 = new Database(onlySqlite(R2_META_DIR, "R2"), { readonly: true });
const lookup = r2.prepare("SELECT blob_id, size FROM _mf_objects WHERE key = ?");

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });

let copied = 0;
const missing = [];
for (const file of files) {
  const key = `${build.artifact_prefix}/${file.path}`;
  const row = lookup.get(key);
  if (!row) {
    missing.push(file.path);
    continue;
  }
  const source = join(R2_BLOBS, row.blob_id);
  if (!existsSync(source)) {
    missing.push(file.path);
    continue;
  }
  const target = join(outDir, file.path);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  copied += 1;
}

console.log(`[pull] build   ${build.id}`);
console.log(`[pull] copied  ${copied}/${files.length} artifact files`);
console.log(`[pull] out     ${outDir}`);

if (missing.length > 0) {
  console.error(`[pull] MISSING ${missing.length} objects:`);
  for (const path of missing.slice(0, 10)) console.error(`         ${path}`);
  process.exit(1);
}

console.log("\nRun it with:");
console.log(`  node scripts/theme-artifact-smoke.mjs --artifact "${outDir}" --port 8799`);
