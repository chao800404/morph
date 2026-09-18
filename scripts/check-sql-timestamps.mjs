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
 * So this is a whitelist, not a blacklist: a migration may reach for the clock
 * in exactly two spellings, one per convention. Anything else has to be read by
 * a person before it ships, which is the point.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const migrationsDir = join(projectRoot, "drizzle");

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

const files = readdirSync(migrationsDir)
  .filter((entry) => entry.endsWith(".sql"))
  .sort();

const findings = [];

for (const entry of files) {
  if (KNOWN.has(entry)) continue;
  const full = join(migrationsDir, entry);
  const source = readFileSync(full, "utf8");

  // Blank out comments and every approved spelling, then look for what is
  // left. Masking rather than matching keeps line numbers intact, and means a
  // clock call inside an approved expression — `unixepoch` inside the
  // millisecond cast — is not reported twice.
  //
  // Comments are masked because a migration that repairs a clock value has to
  // name the one it is repairing: this scan flagged 0054's own explanation of
  // 0024 four times before it learned to read only the statements.
  let masked = source.replace(/--[^\n]*/g, (match) => " ".repeat(match.length));
  for (const allowed of ALLOWED) {
    masked = masked.replace(allowed, (match) => " ".repeat(match.length));
  }

  CLOCK.lastIndex = 0;
  for (const match of masked.matchAll(CLOCK)) {
    const line = masked.slice(0, match.index).split("\n").length;
    findings.push({
      file: relative(projectRoot, full),
      line,
      found: source.split("\n")[line - 1]?.trim().slice(0, 100) ?? match[0],
    });
  }
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
  `[check-sql-timestamps] OK — scanned ${files.length - KNOWN.size} migrations, every clock value matches its column's convention.`,
);
for (const [file, reason] of KNOWN) {
  console.log(`[check-sql-timestamps] skipped ${file}: ${reason}.`);
}
