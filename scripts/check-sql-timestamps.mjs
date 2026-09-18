#!/usr/bin/env node
/**
 * Fails when a migration writes a clock value the schema cannot read back.
 *
 * TypeScript writers cannot get this wrong. Drizzle types every timestamp
 * column by its convention, so a number into `text("created_at")` is
 * `TS2322: Type 'number' is not assignable to type 'string'`, and an ISO
 * string into `integer("created_at", { mode: "timestamp_ms" })` is
 * `TS2322: Type 'string' is not assignable to type 'Date'`. Both are compile
 * errors today; the boundary exists and `tsc` enforces it on 157 call sites.
 *
 * Raw SQL is the one place that boundary is not there, and it is exactly where
 * the failures have happened:
 *
 * - `0024_remarkable_omega_flight.sql` sets `sales_channels.updated_at` to
 *   `CURRENT_TIMESTAMP`. That column is `text` holding ISO-8601. SQLite's
 *   `CURRENT_TIMESTAMP` is UTC but formatted `2026-09-18 07:39:52`, and
 *   `new Date("2026-09-18 07:39:52")` reads a space-separated string as *local*
 *   time — so the value comes back shifted by the reader's offset, differently
 *   on different machines. It also sorts before every ISO value for the same
 *   day, because a space precedes `T`.
 * - `seed-e2e.mjs` wrote `Date.now()` into the same kind of column. SQLite
 *   stored the number without complaint, the catalog list survived it because
 *   `JSON.stringify` turns an Invalid Date into `null`, and the detail DTO
 *   threw `Invalid time value` three layers away, surfacing as the Theme's
 *   "This product is temporarily unavailable".
 *
 * So this is a whitelist, not a blacklist: raw SQL may reach for the clock in
 * exactly two spellings, one per convention. Anything else has to be read by a
 * person before it ships, which is the point.
 *
 * Two roots, because there are two ways raw SQL reaches the database. A schema
 * `.default(sql`…`)` is safe for a reason rather than by luck — drizzle-kit
 * materialises it into `drizzle/*.sql`, so the migration scan sees it there —
 * but a `sql` template in a DAL never becomes a migration file and would never
 * be seen at all.
 *
 * In TypeScript only the contents of a `sql` template are read, which is both
 * precise and necessary. `sql` is the one path raw SQL takes to the database
 * here: `db.batch` takes query builders, and nothing calls `.prepare` with a
 * string. Scanning whole files instead would have reported Zod's `.datetime()`
 * twice out of bundled type declarations in
 * `editor-code-package-declarations.generated.ts`, and `date(` and `time(`
 * would match ordinary TypeScript everywhere. A guard with false positives gets
 * switched off, which costs more than the guard was worth.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const migrationsDir = join(projectRoot, "drizzle");
const sourceDir = join(projectRoot, "src");

/** Contents of a drizzle `sql` tagged template. No backtick can appear inside. */
const SQL_TEMPLATE = /\bsql`([^`]*)`/g;

/**
 * The two spellings that match what the DAL writes.
 *
 * `%f` is seconds with milliseconds, so the first produces
 * `2026-09-18T07:39:52.957Z` — the same shape as `new Date().toISOString()`,
 * character for character. The second is what drizzle-kit generates for
 * `integer(..., { mode: "timestamp_ms" })`, and is already in eight migrations.
 */
const ALLOWED = [
  /strftime\(\s*'%Y-%m-%dT%H:%M:%fZ'\s*,\s*'now'\s*\)/gi,
  /unixepoch\(\s*'subsecond'\s*\)\s*\*\s*1000/gi,
];

/**
 * Migrations whose clock values are wrong and must stay that way.
 *
 * An applied migration is history. Editing `0024` would not re-run anywhere and
 * would not repair a single damaged row; it would only make the record of what
 * happened disagree with what happened. So the repair is
 * `0054_normalize_sales_channel_timestamps.sql`, and the entry here is narrow
 * on purpose — the file and the reason, not a pattern that would quietly cover
 * the next one.
 */
const KNOWN = new Map([
  [
    "0024_remarkable_omega_flight.sql",
    "two `CURRENT_TIMESTAMP` writes into `sales_channels`, repaired by 0054",
  ],
]);

/** Every way SQLite can name the current time. */
const CLOCK = /\b(CURRENT_TIMESTAMP|CURRENT_DATE|CURRENT_TIME|datetime\s*\(|date\s*\(|time\s*\(|julianday\s*\(|unixepoch\s*\(|strftime\s*\()/gi;

const migrations = readdirSync(migrationsDir)
  .filter((entry) => entry.endsWith(".sql"))
  .sort();

/** Every `.ts`/`.tsx` under `src`, which is where a `sql` template can live. */
function collectSources(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...collectSources(full));
    else if (/\.(ts|tsx)$/.test(entry)) found.push(full);
  }
  return found;
}

const sources = collectSources(sourceDir);
const findings = [];

/** Blanks approved spellings so what remains is what nobody has vouched for. */
function maskApproved(text) {
  let masked = text;
  for (const allowed of ALLOWED) {
    masked = masked.replace(allowed, (match) => " ".repeat(match.length));
  }
  return masked;
}

/** Reports every clock call left in `masked`, located against `source`. */
function report(file, source, masked) {
  CLOCK.lastIndex = 0;
  for (const match of masked.matchAll(CLOCK)) {
    const line = masked.slice(0, match.index).split("\n").length;
    findings.push({
      file: relative(projectRoot, file),
      line,
      found: source.split("\n")[line - 1]?.trim().slice(0, 100) ?? match[0],
    });
  }
}

for (const entry of migrations) {
  if (KNOWN.has(entry)) continue;
  const full = join(migrationsDir, entry);
  const source = readFileSync(full, "utf8");

  // Comments are masked because a migration that repairs a clock value has to
  // name the one it is repairing: this scan flagged 0054's own explanation of
  // 0024 four times before it learned to read only the statements. Masking
  // rather than stripping keeps every line number pointing at the real file.
  const withoutComments = source.replace(/--[^\n]*/g, (match) =>
    " ".repeat(match.length),
  );
  report(full, source, maskApproved(withoutComments));
}

for (const full of sources) {
  const source = readFileSync(full, "utf8");
  // Everything outside a `sql` template is blanked, so only SQL is read while
  // the offsets still point at the right line of the real file.
  let masked = " ".repeat(source.length).split("");
  for (const match of source.matchAll(SQL_TEMPLATE)) {
    const start = match.index + match[0].indexOf("`") + 1;
    for (let at = 0; at < match[1].length; at += 1) {
      masked[start + at] = match[1][at];
    }
  }
  const template = source.replace(/[^\n]/g, " ");
  masked = masked
    .map((character, at) => (character === " " ? template[at] : character))
    .join("");
  report(full, source, maskApproved(masked));
}

if (findings.length > 0) {
  console.error("\n[check-sql-timestamps] Clock values a migration should not write:\n");
  for (const { file, line, found } of findings) {
    console.error(`  ${file}:${line}\n    → ${found}`);
  }
  console.error(
    "\nUse the spelling that matches the column's convention:\n" +
      "  text ISO-8601      strftime('%Y-%m-%dT%H:%M:%fZ', 'now')\n" +
      "  integer timestamp_ms  (cast(unixepoch('subsecond') * 1000 as integer))\n" +
      "\nA value in any other format is stored happily and read back wrong:\n" +
      "SQLite's own `2026-09-18 07:39:52` is parsed by `new Date` as local time.\n",
  );
  process.exit(1);
}

console.log(
  `[check-sql-timestamps] OK — scanned ${migrations.length - KNOWN.size} migrations and ${sources.length} source files, every clock value matches its column's convention.`,
);
for (const [file, reason] of KNOWN) {
  console.log(`[check-sql-timestamps] skipped ${file}: ${reason}.`);
}
