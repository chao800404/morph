#!/usr/bin/env node
/**
 * Refuses to go on while the D1 database and this checkout's migrations
 * disagree; see `pending-migrations.mjs` for the rule.
 *
 *   node scripts/check-pending-migrations.mjs --remote     before `wrangler deploy`
 *   node scripts/check-pending-migrations.mjs --local [--persist-to <dir>]
 *   node scripts/check-pending-migrations.mjs --files-only  numbering only, no database
 *
 * It only reads: `SELECT name FROM d1_migrations`. Applying migrations stays
 * a separate, deliberate step (`pnpm db:migrate:prod`).
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  compareMigrations,
  describeMigrationState,
  duplicateMigrationNumbers,
  migrationFiles,
  parseAppliedMigrations,
} from "./pending-migrations.mjs";
import { parseJsonc } from "./theme-runtime-wiring-scan.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BINDING = "DATABASE";

function fail(message) {
  console.error(`[check-pending-migrations] ${message}`);
  process.exit(1);
}

function option(args, name) {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

const args = process.argv.slice(2);
const filesOnly = args.includes("--files-only");
const remote = args.includes("--remote");
const local = args.includes("--local");
if (!filesOnly && remote === local) {
  fail("Name the database: --remote or --local (or --files-only).");
}
const environment = option(args, "--env");
const persistTo = option(args, "--persist-to");

const config = parseJsonc(readFileSync(join(ROOT, "wrangler.jsonc"), "utf8"));
if (!config.ok) fail(`wrangler.jsonc does not parse: ${config.error}`);
const scope = environment ? config.value.env?.[environment] : config.value;
if (!scope) fail(`wrangler.jsonc has no environment "${environment}".`);
const database = scope.d1_databases?.find((entry) => entry.binding === BINDING);
if (!database) fail(`wrangler.jsonc binds no D1 database as ${BINDING}.`);

const directory = join(ROOT, database.migrations_dir ?? "migrations");
const files = migrationFiles(readdirSync(directory));
const duplicates = duplicateMigrationNumbers(files);

let pending = [];
let unknown = [];
if (!filesOnly) {
  const result = spawnSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      BINDING,
      remote ? "--remote" : "--local",
      ...(environment ? ["--env", environment] : []),
      ...(persistTo ? ["--persist-to", persistTo] : []),
      "--json",
      "--command",
      "SELECT name FROM d1_migrations ORDER BY id",
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (result.error) fail(`Could not run Wrangler: ${result.error.message}`);
  // Wrangler prints its JSON on stdout even when the query fails.
  const parsed = parseAppliedMigrations(result.stdout.trim());
  if (!parsed.ok) {
    fail(`Could not read the applied migrations: ${parsed.reason}${result.stderr ? `\n${result.stderr.trim().slice(-500)}` : ""}`);
  }
  ({ pending, unknown } = compareMigrations({ files, applied: parsed.applied }));
}

const verdict = describeMigrationState({
  pending,
  unknown,
  duplicates,
  target: filesOnly ? null : remote ? "remote" : "local",
});
const print = verdict.ok ? console.log : console.error;
for (const line of verdict.lines) print(`[check-pending-migrations] ${line}`);
if (filesOnly && verdict.ok) {
  console.log(`[check-pending-migrations] ${files.length} migration files, numbered without repeats.`);
}
process.exit(verdict.ok ? 0 : 1);
