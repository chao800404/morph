/**
 * The rule `pnpm run deploy` checks before it deploys: the database has every
 * migration this checkout has, and no other.
 *
 * `node --test`, like the ship gate's tests: vitest collects `src/` only, and
 * a guard whose tests never run is not a guard.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

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

/**
 * The deploy gate itself — `node scripts/check-pending-migrations.mjs
 * --remote`, the first step of `pnpm run deploy` — run as a process against
 * this checkout's real `drizzle/` directory. Wrangler is replaced by an `npx`
 * stub first on PATH that prints a fixture as the applied list and records
 * its arguments; nothing reaches Cloudflare. Migration 0080
 * (`storefront_themes.preview_runtime`) is the case in point: code that
 * reads that column must not deploy to a database without it, and a checkout
 * without it must not deploy to a database that has it.
 */
describe("check-pending-migrations.mjs --remote, the deploy gate", () => {
  const scriptsDir = dirname(fileURLToPath(import.meta.url));
  const root = join(scriptsDir, "..");
  const files = migrationFiles(readdirSync(join(root, "drizzle")));
  const RUNTIME = "0080_theme_preview_runtime.sql";

  /**
   * The gate's environment: the stub first on PATH, and nothing that could
   * reach a real Cloudflare account if the stub were ever bypassed (the gate
   * calling Wrangler another way, say). Every CLOUDFLARE_*, CF_* and
   * WRANGLER_* variable is dropped, and HOME and XDG_CONFIG_HOME point at the
   * temporary directory, so no stored `wrangler login` is found either. A
   * bypassed stub then fails for lack of credentials, never against a live
   * database.
   */
  function offlineEnv(stubDir) {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => !/^(CLOUDFLARE_|CF_|WRANGLER_)/.test(name),
      ),
    );
    return {
      ...env,
      PATH: `${stubDir}:${process.env.PATH}`,
      HOME: stubDir,
      XDG_CONFIG_HOME: stubDir,
    };
  }

  it("leaves no Cloudflare credential in the gate's environment", () => {
    // Set here, with placeholder values, so the filter is shown to drop
    // them rather than passing because the shell had none.
    const planted = {
      CLOUDFLARE_API_TOKEN: "placeholder",
      CLOUDFLARE_API_KEY: "placeholder",
      CLOUDFLARE_EMAIL: "placeholder",
      CLOUDFLARE_ACCOUNT_ID: "placeholder",
      CF_API_TOKEN: "placeholder",
      WRANGLER_AUTH_TOKEN: "placeholder",
    };
    const before = Object.fromEntries(
      Object.keys(planted).map((name) => [name, process.env[name]]),
    );
    Object.assign(process.env, planted);
    let env;
    try {
      env = offlineEnv("/nonexistent");
    } finally {
      for (const [name, value] of Object.entries(before)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
    for (const name of Object.keys(planted)) {
      assert.equal(env[name], undefined, name);
    }
    assert.deepEqual(
      Object.keys(env).filter((name) =>
        /^(CLOUDFLARE_|CF_|WRANGLER_)/.test(name),
      ),
      [],
    );
    assert.equal(env.HOME, "/nonexistent");
    assert.equal(env.XDG_CONFIG_HOME, "/nonexistent");
  });

  /** Runs the gate with Wrangler answering `applied`; never a real Wrangler. */
  function gate(applied) {
    const dir = mkdtempSync(join(tmpdir(), "deploy-gate-"));
    try {
      writeFileSync(
        join(dir, "applied.json"),
        JSON.stringify([
          { results: applied.map((name) => ({ name })), success: true, meta: {} },
        ]),
      );
      writeFileSync(
        join(dir, "npx"),
        `#!/bin/sh\nprintf '%s\\n' "$@" > "${dir}/args.txt"\ncat "${dir}/applied.json"\n`,
      );
      chmodSync(join(dir, "npx"), 0o755);
      const result = spawnSync(
        process.execPath,
        [join(scriptsDir, "check-pending-migrations.mjs"), "--remote"],
        { cwd: root, encoding: "utf8", env: offlineEnv(dir) },
      );
      // The stub answered, or nothing here was tested: a gate that stopped
      // calling `npx` through PATH must fail this test, not pass it on
      // whatever a real Wrangler said.
      assert.ok(
        existsSync(join(dir, "args.txt")),
        `The npx stub was not invoked:\n${result.stdout}${result.stderr}`,
      );
      return {
        status: result.status,
        out: `${result.stdout}${result.stderr}`,
        args: readFileSync(join(dir, "args.txt"), "utf8").trim().split("\n"),
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("is what pnpm run deploy runs first", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    assert.match(
      pkg.scripts.deploy,
      /^node scripts\/check-pending-migrations\.mjs --remote && /,
    );
    assert.ok(files.includes(RUNTIME), `${RUNTIME} is in drizzle/`);
  });

  it("only reads the remote database's migration list", () => {
    const { args } = gate(files);
    assert.deepEqual(args.slice(0, 5), ["wrangler", "d1", "execute", "DATABASE", "--remote"]);
    assert.equal(args.at(-1), "SELECT name FROM d1_migrations ORDER BY id");
  });

  it("refuses while the database has not applied 0080", () => {
    const { status, out } = gate(files.filter((file) => file !== RUNTIME));
    assert.equal(status, 1);
    assert.match(out, /The remote database has not applied 1 migration\(s\) this code needs:/);
    assert.match(out, new RegExp(`  ${RUNTIME.replace(".", "\\.")}`));
    assert.match(out, /Apply them first \(pnpm db:migrate:prod\), then deploy\. This check does not apply them\./);
  });

  it("refuses a checkout older than the database's schema", () => {
    const { status, out } = gate([...files, "0081_from_a_newer_checkout.sql"]);
    assert.equal(status, 1);
    assert.match(out, /has applied 1 migration\(s\) this checkout does not have:/);
    assert.match(out, /0081_from_a_newer_checkout\.sql/);
    assert.match(out, /This code is older than the schema\. Update the checkout before deploying\./);
  });

  it("refuses a code rollback whose checkout lacks 0080 once the database has it", () => {
    // The old checkout's own list, the database's list with 0080: the gate a
    // rollback through `pnpm run deploy` meets
    // (scripts/rollback/0080_theme_preview_runtime.md).
    const verdict = describeMigrationState({
      ...compareMigrations({
        files: files.filter((file) => file !== RUNTIME),
        applied: files,
      }),
      duplicates: [],
      target: "remote",
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.lines.join("\n"), /This code is older than the schema/);
  });

  it("passes when the database has exactly this checkout's migrations", () => {
    const { status, out } = gate(files);
    assert.equal(status, 0);
    assert.match(out, /The remote database has every migration this code expects, and no other\./);
  });

  it("refuses two migrations sharing 0080's number", () => {
    const withTwin = migrationFiles([...files, "0080_another_change.sql"]);
    const duplicates = duplicateMigrationNumbers(withTwin);
    assert.deepEqual(duplicates, [
      { number: "0080", files: ["0080_another_change.sql", RUNTIME] },
    ]);
    const verdict = describeMigrationState({
      ...compareMigrations({ files: withTwin, applied: withTwin }),
      duplicates,
      target: "remote",
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.lines.join("\n"), /Renumber one of them before applying or deploying\./);
  });
});
