import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let sqlite: Database.Database;

vi.mock("cloudflare:workers", () => ({
  env: {
    DATABASE: {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          run: () => {
            // The DAL binds `?1`-style parameters, which better-sqlite3 takes
            // as a named object rather than positionally.
            const params = Object.fromEntries(
              args.map((value, index) => [String(index + 1), value]),
            );
            const info = sqlite.prepare(sql).run(params);
            return { meta: { changes: info.changes } };
          },
        }),
      }),
    },
  },
}));
vi.mock("@/db", () => ({ getDb: vi.fn() }));

import { adminStatusDal } from "./admin-status.dal";

const insertUser = (id: string, email: string) =>
  sqlite
    .prepare(
      `INSERT INTO users (id, name, email, email_verified, role, created_at, updated_at)
       VALUES (?, ?, ?, 0, 'user', 0, 0)`,
    )
    .run(id, id, email);

const adminIds = () =>
  sqlite
    .prepare(`SELECT id FROM users WHERE role = 'admin' ORDER BY id`)
    .all()
    .map((row) => (row as { id: string }).id);

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE users (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      email text NOT NULL UNIQUE,
      email_verified integer NOT NULL DEFAULT 0,
      role text DEFAULT 'guest',
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );
  `);
});

afterEach(() => {
  sqlite.close();
  vi.clearAllMocks();
});

describe("claimFirstAdmin", () => {
  it("promotes the caller when there is no admin yet", async () => {
    insertUser("u1", "one@example.com");

    expect(await adminStatusDal.claimFirstAdmin("u1")).toBe(true);
    expect(adminIds()).toEqual(["u1"]);
  });

  // The bug this exists for: two bootstrap requests with different emails both
  // pass a separate "is there an admin?" check, and unique email does not stop
  // them, so the condition has to live inside the write.
  it("lets exactly one of two concurrent bootstraps win", async () => {
    insertUser("u1", "one@example.com");
    insertUser("u2", "two@example.com");

    const results = await Promise.all([
      adminStatusDal.claimFirstAdmin("u1"),
      adminStatusDal.claimFirstAdmin("u2"),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(adminIds()).toHaveLength(1);
  });

  it("refuses once an admin exists", async () => {
    insertUser("u1", "one@example.com");
    insertUser("u2", "two@example.com");
    await adminStatusDal.claimFirstAdmin("u1");

    expect(await adminStatusDal.claimFirstAdmin("u2")).toBe(false);
    expect(adminIds()).toEqual(["u1"]);
  });

  it("reports failure for a user that does not exist", async () => {
    expect(await adminStatusDal.claimFirstAdmin("ghost")).toBe(false);
    expect(adminIds()).toEqual([]);
  });
});
