/**
 * The rule `pnpm run deploy` checks before it deploys: the database has every
 * migration this checkout has, and no other.
 *
 * `node --test`, like the ship gate's tests: vitest collects `src/` only, and
 * a guard whose tests never run is not a guard.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compareMigrations,
  describeMigrationState,
  duplicateMigrationNumbers,
  migrationFiles,
  parseAppliedMigrations,
} from "./pending-migrations.mjs";

describe("migrationFiles", () => {
  it("keeps numbered .sql files, in the order Wrangler applies them", () => {
    assert.deepEqual(
      migrationFiles(["0002_b.sql", "meta", "0000_a.sql", "README.md", "0001_c.sql", "notes.sql"]),
      ["0000_a.sql", "0001_c.sql", "0002_b.sql"],
    );
  });
});

describe("duplicateMigrationNumbers", () => {
  it("names numbers two files share", () => {
    assert.deepEqual(
      duplicateMigrationNumbers(["0059_a.sql", "0060_b.sql", "0060_c.sql"]),
      [{ number: "0060", files: ["0060_b.sql", "0060_c.sql"] }],
    );
    assert.deepEqual(duplicateMigrationNumbers(["0000_a.sql", "0001_b.sql"]), []);
  });
});

describe("parseAppliedMigrations", () => {
  it("reads the names from Wrangler's JSON", () => {
    const stdout = JSON.stringify([
      { results: [{ name: "0000_a.sql" }, { name: "0001_b.sql" }], success: true, meta: {} },
    ]);
    assert.deepEqual(parseAppliedMigrations(stdout), {
      ok: true,
      applied: ["0000_a.sql", "0001_b.sql"],
    });
  });

  it("reads a database with no migrations table as having applied none", () => {
    // What Wrangler prints, and exits 1 with, for a new database.
    const stdout = JSON.stringify({
      error: { text: "no such table: d1_migrations: SQLITE_ERROR" },
    });
    assert.deepEqual(parseAppliedMigrations(stdout), { ok: true, applied: [] });
  });

  it("never reads a failure as nothing applied", () => {
    for (const stdout of [
      "",
      "Authentication error",
      JSON.stringify({ error: { text: "D1_ERROR: database not found" } }),
      JSON.stringify([{ results: [], success: false }]),
      JSON.stringify([{ results: [{ id: 1 }], success: true }]),
      JSON.stringify({}),
    ]) {
      assert.equal(parseAppliedMigrations(stdout).ok, false, stdout);
    }
  });
});

describe("compareMigrations", () => {
  it("finds what the database has not applied, and what it has that the checkout lacks", () => {
    assert.deepEqual(
      compareMigrations({
        files: ["0000_a.sql", "0001_b.sql", "0002_c.sql"],
        applied: ["0000_a.sql", "0001_old_name.sql"],
      }),
      { pending: ["0001_b.sql", "0002_c.sql"], unknown: ["0001_old_name.sql"] },
    );
  });

  it("finds nothing when the two agree", () => {
    const files = ["0000_a.sql", "0001_b.sql"];
    assert.deepEqual(compareMigrations({ files, applied: files }), { pending: [], unknown: [] });
  });
});

describe("describeMigrationState", () => {
  const none = { pending: [], unknown: [], duplicates: [] };

  it("passes only with nothing pending, unknown or duplicated", () => {
    assert.equal(describeMigrationState({ ...none, target: "remote" }).ok, true);
    assert.equal(
      describeMigrationState({ ...none, pending: ["0060_x.sql"], target: "remote" }).ok,
      false,
    );
    assert.equal(
      describeMigrationState({ ...none, unknown: ["0060_x.sql"], target: "remote" }).ok,
      false,
    );
    assert.equal(
      describeMigrationState({
        ...none,
        duplicates: [{ number: "0060", files: ["0060_a.sql", "0060_b.sql"] }],
        target: null,
      }).ok,
      false,
    );
  });

  it("tells a remote deploy to apply first, and never claims to have applied", () => {
    const { lines } = describeMigrationState({
      ...none,
      pending: ["0060_x.sql"],
      target: "remote",
    });
    const text = lines.join("\n");
    assert.match(text, /0060_x\.sql/);
    assert.match(text, /pnpm db:migrate:prod/);
    assert.match(text, /does not apply them/);
  });

  it("says nothing about a database it did not read", () => {
    const { lines } = describeMigrationState({ ...none, target: null });
    assert.equal(lines.some((line) => /database/.test(line)), false);
  });
});
