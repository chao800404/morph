// @vitest-environment node
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { createRequire } from "node:module";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { queryLifecycleD1 } from "../../../scripts/verify-published-artifact.mjs";

const roots: string[] = [];
const children: ChildProcess[] = [];
const require = createRequire(import.meta.url);

function database() {
  const root = mkdtempSync(path.join(tmpdir(), "morph-lifecycle-lock-"));
  roots.push(root);
  const directory = path.join(root, "v3/d1/miniflare-D1DatabaseObject");
  mkdirSync(directory, { recursive: true });
  const filename = path.join(directory, "test.sqlite");
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.exec("CREATE TABLE probe (value TEXT); INSERT INTO probe VALUES ('ok')");
  db.close();
  return { root, directory, filename };
}

async function holdExclusive(filename: string, releaseAfterMs: number) {
  const source = `const Database = require(process.argv[1]);
const db = new Database(process.argv[2]);
db.pragma('locking_mode = EXCLUSIVE'); db.exec('BEGIN EXCLUSIVE');
console.log('held');
setTimeout(() => { db.exec('ROLLBACK'); db.close(); }, Number(process.argv[3]));`;
  const child = spawn(
    process.execPath,
    [
      "-e",
      source,
      require.resolve("better-sqlite3"),
      filename,
      String(releaseAfterMs),
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  children.push(child);
  const [data] = (await once(child.stdout!, "data")) as [Buffer];
  expect(data.toString()).toContain("held");
}

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
  }
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("lifecycle run D1 reads", () => {
  it("waits for a different process to release its exclusive lock", async () => {
    const { root, filename } = database();
    await holdExclusive(filename, 1_500);
    const started = Date.now();
    expect(
      queryLifecycleD1(root, "SELECT value FROM probe WHERE value = ?", "ok"),
    ).toEqual([{ value: "ok" }]);
    expect(Date.now() - started).toBeGreaterThan(500);
  });

  it("fails with SQLITE_BUSY after the bounded 10 second lock wait", async () => {
    const { root, filename } = database();
    await holdExclusive(filename, 15_000);
    const started = Date.now();
    expect(() => queryLifecycleD1(root, "SELECT value FROM probe")).toThrow(
      /locked|SQLITE_BUSY/i,
    );
    expect(Date.now() - started).toBeGreaterThanOrEqual(9_000);
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  it("rejects an ambiguous D1 directory without selecting a database", () => {
    const { root, directory } = database();
    new Database(path.join(directory, "second.sqlite")).close();
    expect(() => queryLifecycleD1(root, "SELECT value FROM probe")).toThrow(
      /found 2/,
    );
  });
});
