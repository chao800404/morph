/**
 * Whether a D1 database has every migration this checkout expects, and no
 * other — decided from two lists, so the rule can be tested without a
 * database.
 *
 * Deploying Worker code whose schema is not in the database fails at the
 * first query that needs it, in production, after the deploy reported
 * success. The opposite case is as bad and quieter: a database that has
 * migrations this checkout does not know means the code being deployed is
 * older than the schema — a stale branch, or someone else's deploy — and
 * its queries may name columns that no longer mean what it thinks.
 *
 * Wrangler records an applied migration in `d1_migrations` by its file name
 * (`0059_theme_binary_files.sql`) and applies files in name order, so two
 * files sharing a number are an ordering accident waiting for whichever
 * name sorts first.
 */

const MIGRATION_FILE = /^(\d{4})_[A-Za-z0-9_-]+\.sql$/;

/** The migration files among a directory's entries, in the order Wrangler applies them. */
export function migrationFiles(entries) {
  return entries.filter((name) => MIGRATION_FILE.test(name)).sort();
}

/** Numbers two or more migration files share, with the files. */
export function duplicateMigrationNumbers(files) {
  const byNumber = new Map();
  for (const file of files) {
    const number = MIGRATION_FILE.exec(file)?.[1];
    if (!number) continue;
    byNumber.set(number, [...(byNumber.get(number) ?? []), file]);
  }
  return [...byNumber]
    .filter(([, named]) => named.length > 1)
    .map(([number, named]) => ({ number, files: named }));
}

/**
 * The names of applied migrations, from `wrangler d1 execute --json` output
 * of `SELECT name FROM d1_migrations`. A database with no `d1_migrations`
 * table has applied none. Anything else that is not a result is an error:
 * "could not read" must never pass for "nothing applied".
 */
export function parseAppliedMigrations(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { ok: false, reason: `Wrangler did not print JSON: ${stdout.slice(0, 200)}` };
  }
  const errorText = parsed?.error?.text;
  if (typeof errorText === "string") {
    if (/no such table: d1_migrations/.test(errorText)) return { ok: true, applied: [] };
    return { ok: false, reason: errorText };
  }
  const first = Array.isArray(parsed) ? parsed[0] : null;
  if (!first || first.success !== true || !Array.isArray(first.results)) {
    return { ok: false, reason: `Unexpected Wrangler output: ${stdout.slice(0, 200)}` };
  }
  const applied = first.results.map((row) => row?.name);
  if (applied.some((name) => typeof name !== "string")) {
    return { ok: false, reason: "A d1_migrations row has no name." };
  }
  return { ok: true, applied };
}

/**
 * What stands between this checkout and the database: files it has not
 * applied, and applied migrations this checkout does not have.
 */
export function compareMigrations({ files, applied }) {
  const appliedSet = new Set(applied);
  const fileSet = new Set(files);
  return {
    pending: files.filter((file) => !appliedSet.has(file)),
    unknown: applied.filter((name) => !fileSet.has(name)),
  };
}

/**
 * The verdict and the lines to print, for a comparison and the duplicates
 * found. `target` is `"remote"` or `"local"`, or null when no database was read.
 */
export function describeMigrationState({ pending, unknown, duplicates, target }) {
  const lines = [];
  if (duplicates.length > 0) {
    lines.push("Migration files share a number, so their order is an accident of their names:");
    for (const { number, files } of duplicates) lines.push(`  ${number}: ${files.join(", ")}`);
    lines.push("Renumber one of them before applying or deploying.");
  }
  if (pending.length > 0) {
    lines.push(`The ${target} database has not applied ${pending.length} migration(s) this code needs:`);
    for (const file of pending) lines.push(`  ${file}`);
    lines.push(
      target === "remote"
        ? "Apply them first (pnpm db:migrate:prod), then deploy. This check does not apply them."
        : "Apply them first (pnpm db:migrate:dev).",
    );
  }
  if (unknown.length > 0) {
    lines.push(`The ${target} database has applied ${unknown.length} migration(s) this checkout does not have:`);
    for (const name of unknown) lines.push(`  ${name}`);
    lines.push("This code is older than the schema. Update the checkout before deploying.");
  }
  const ok = duplicates.length === 0 && pending.length === 0 && unknown.length === 0;
  // With no database read, there is nothing to say about one.
  if (ok && target) {
    lines.push(`The ${target} database has every migration this code expects, and no other.`);
  }
  return { ok, lines };
}
