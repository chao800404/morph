import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { storefrontThemeSyncCapabilityDal as dal } from "../../dal/storefront-theme-sync-capability.dal";
import {
  DEFAULT_THEME_SYNC_TTL_MS,
  hashThemeSyncToken,
  issueThemeSyncCapability,
  themeSyncTokenFromAuthorization,
  verifyThemeSyncCapability,
} from "./theme-sync-capability";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ getDb: vi.fn() }));

let sqlite: Database.Database;
const NOW = new Date("2026-10-09T00:00:00.000Z");
const later = (ms: number) => new Date(NOW.getTime() + ms);

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  // Only the columns the capability reads; the table itself is the migration's.
  sqlite.exec(`
    CREATE TABLE users (id text PRIMARY KEY, role text, banned integer);
    CREATE TABLE storefronts (id text PRIMARY KEY);
    CREATE TABLE storefront_themes (
      id text PRIMARY KEY, storefront_id text NOT NULL, deleted_at text
    );
    INSERT INTO users VALUES ('admin-1', 'admin', 0), ('guest-1', 'guest', 0),
      ('banned-1', 'admin', 1);
    INSERT INTO storefronts VALUES ('store-a'), ('store-b');
    INSERT INTO storefront_themes VALUES ('theme-a', 'store-a', NULL),
      ('theme-b', 'store-b', NULL);
  `);
  sqlite.exec(
    readFileSync(resolve("drizzle/0078_theme_sync_capabilities.sql"), "utf8")
      .split("--> statement-breakpoint")
      .join("\n"),
  );
  vi.mocked(getDb).mockResolvedValue(drizzle(sqlite, { schema }) as never);
});

afterEach(() => sqlite.close());

const issue = (
  overrides: Partial<{ storefrontId: string; themeId: string; userId: string }> = {},
) =>
  issueThemeSyncCapability({
    dal,
    storefrontId: "store-a",
    themeId: "theme-a",
    userId: "admin-1",
    now: NOW,
    ...overrides,
  });

async function issuedToken(overrides: Parameters<typeof issue>[0] = {}) {
  const issued = await issue(overrides);
  if (!issued.ok) throw new Error(issued.reason);
  return issued.token;
}

const verify = (token: string, now = later(1000)) =>
  verifyThemeSyncCapability({ dal, token, now });

describe("a local sync capability", () => {
  it("is a prefixed random token stored only as a hash", async () => {
    const token = await issuedToken();
    expect(token).toMatch(/^mts_[0-9a-f]{40}$/);
    const rows = sqlite
      .prepare("SELECT token_hash FROM storefront_theme_sync_capabilities")
      .all() as { token_hash: string }[];
    expect(rows).toEqual([{ token_hash: await hashThemeSyncToken(token) }]);
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it("verifies to its user, store and Theme", async () => {
    expect(await verify(await issuedToken())).toEqual({
      ok: true,
      capability: expect.objectContaining({
        storefrontId: "store-a",
        themeId: "theme-a",
        userId: "admin-1",
        expiresAt: later(DEFAULT_THEME_SYNC_TTL_MS).toISOString(),
      }),
    });
  });

  it("is refused once it expires", async () => {
    const token = await issuedToken();
    expect(await verify(token, later(DEFAULT_THEME_SYNC_TTL_MS))).toEqual({
      ok: false,
      reason: "CAPABILITY_EXPIRED",
    });
  });

  it("is refused once revoked", async () => {
    const token = await issuedToken();
    await dal.revoke({ tokenHash: await hashThemeSyncToken(token), now: NOW.toISOString() });
    expect(await verify(token)).toEqual({ ok: false, reason: "CAPABILITY_REVOKED" });
  });

  it("is replaced, not added to, when the same admin links the Theme again", async () => {
    const first = await issuedToken();
    const second = await issuedToken();
    expect(await verify(first)).toEqual({ ok: false, reason: "CAPABILITY_REVOKED" });
    expect((await verify(second)).ok).toBe(true);
  });

  it("is refused once its holder is no longer an admin", async () => {
    const token = await issuedToken();
    sqlite.prepare("UPDATE users SET role = 'user' WHERE id = 'admin-1'").run();
    expect(await verify(token)).toEqual({ ok: false, reason: "USER_NOT_AUTHORIZED" });
  });

  it("is refused once its Theme is deleted", async () => {
    const token = await issuedToken();
    sqlite.prepare("UPDATE storefront_themes SET deleted_at = 'x' WHERE id = 'theme-a'").run();
    expect(await verify(token)).toEqual({ ok: false, reason: "THEME_NOT_AVAILABLE" });
  });

  it.each([
    ["a guest", { userId: "guest-1" }, "USER_NOT_AUTHORIZED"],
    ["a banned admin", { userId: "banned-1" }, "USER_NOT_AUTHORIZED"],
    ["another store's Theme", { themeId: "theme-b" }, "THEME_NOT_AVAILABLE"],
  ] as const)("is never issued to %s", async (_name, overrides, reason) => {
    expect(await issue(overrides)).toEqual({ ok: false, reason });
    const live = sqlite
      .prepare("SELECT COUNT(*) AS n FROM storefront_theme_sync_capabilities WHERE revoked_at IS NULL")
      .get() as { n: number };
    expect(live.n).toBe(0);
  });

  it("is unknown when the token is malformed or never issued", async () => {
    expect(await verify("not-a-token")).toEqual({ ok: false, reason: "CAPABILITY_UNKNOWN" });
    expect(await verify(`mts_${"0".repeat(40)}`)).toEqual({
      ok: false,
      reason: "CAPABILITY_UNKNOWN",
    });
  });

  it("is read from a bearer Authorization header only", () => {
    const token = `mts_${"a".repeat(40)}`;
    expect(themeSyncTokenFromAuthorization(`Bearer ${token}`)).toBe(token);
    expect(themeSyncTokenFromAuthorization(`Basic ${token}`)).toBeNull();
    expect(themeSyncTokenFromAuthorization(`Bearer sk_${"a".repeat(40)}`)).toBeNull();
    expect(themeSyncTokenFromAuthorization(null)).toBeNull();
  });
});
