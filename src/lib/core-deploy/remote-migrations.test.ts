// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { createInventoryApi } from "./cloudflare-api";
import { APPLIED_MIGRATIONS_SQL, checkRemoteMigrations } from "./remote-migrations";
import {
  ACCOUNT,
  D1_ID,
  apiError,
  baseState,
  ok,
  startMockCloudflareApi,
  type MockApi,
} from "./test-support/mock-cloudflare-api";

const apis: MockApi[] = [];
afterEach(async () => {
  for (const api of apis.splice(0)) await api.close();
});

async function check(applied: string[] | "no-table" | "error", entries: string[]) {
  const api = await startMockCloudflareApi(baseState(), {
    handlers: [
      (request) => {
        if (!request.path.endsWith(`/d1/database/${D1_ID}/query`)) return undefined;
        if (applied === "no-table") return apiError(400, 7500, "no such table: d1_migrations: SQLITE_ERROR");
        if (applied === "error") return apiError(403, 10000, "Authentication error");
        return ok([{ success: true, results: applied.map((name) => ({ name })), meta: {} }]);
      },
    ],
  });
  apis.push(api);
  const result = await checkRemoteMigrations({
    api: createInventoryApi({ baseUrl: api.baseUrl, token: "inventory-token", accountId: ACCOUNT }),
    databaseId: D1_ID,
    entries,
  });
  return { result, api };
}

describe("the remote migration check, by the target's database id", () => {
  it("passes when the database has applied exactly this checkout's migrations, and only reads", async () => {
    const { result, api } = await check(["0001_a.sql", "0002_b.sql"], ["0001_a.sql", "0002_b.sql", "README.md"]);
    expect(result.ok).toBe(true);
    expect(api.requests.map((r) => [r.method, r.path, JSON.parse(r.body).sql])).toEqual([
      ["POST", `/accounts/${ACCOUNT}/d1/database/${D1_ID}/query`, APPLIED_MIGRATIONS_SQL],
    ]);
  });

  it.each([
    ["an unapplied migration", ["0001_a.sql"], ["0001_a.sql", "0002_b.sql"]],
    ["a migration this checkout lacks", ["0001_a.sql", "0002_b.sql"], ["0001_a.sql"]],
    ["two files sharing a number", ["0001_a.sql", "0001_b.sql"], ["0001_a.sql", "0001_b.sql"]],
  ])("refuses %s", async (_label, applied, entries) => {
    expect((await check(applied, entries)).result.ok).toBe(false);
  });

  it("treats a database with no d1_migrations table as having applied none", async () => {
    expect((await check("no-table", [])).result.ok).toBe(true);
    expect((await check("no-table", ["0001_a.sql"])).result.ok).toBe(false);
  });

  it("never reads a failure as nothing applied", async () => {
    const { result } = await check("error", []);
    expect(result).toEqual({ ok: false, lines: [expect.stringMatching(/^Could not read the applied migrations/)] });
  });
});
