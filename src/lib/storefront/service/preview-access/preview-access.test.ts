import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { storefrontPreviewAccessDal as dal } from "../../dal/storefront-preview-access.dal";
import {
  PREVIEW_ACCESS_EXCHANGE_TTL_MS,
  PREVIEW_ACCESS_GRANT_MAX_MS,
  hashPreviewAccessSecret,
  issuePreviewAccessExchange,
  redeemPreviewAccessExchange,
  revokePreviewAccessForSession,
  revokePreviewAccessForUser,
  verifyPreviewAccessGrant,
} from "./preview-access";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ getDb: vi.fn() }));

let sqlite: Database.Database;
const NOW = new Date("2026-10-28T00:00:00.000Z");
const later = (ms: number) => new Date(NOW.getTime() + ms);
const DAY = 24 * 60 * 60_000;
const HOST = "pv-preview-a.preview.example.test";

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  // Only the columns these checks read; the two new tables are the migration's.
  sqlite.exec(`
    CREATE TABLE users (id text PRIMARY KEY, role text, banned integer);
    CREATE TABLE sessions (
      id text PRIMARY KEY, token text NOT NULL, user_id text NOT NULL,
      expires_at integer NOT NULL
    );
    CREATE TABLE storefronts (id text PRIMARY KEY);
    CREATE TABLE storefront_themes (
      id text PRIMARY KEY, storefront_id text NOT NULL, deleted_at text
    );
    INSERT INTO users VALUES ('admin-1', 'admin', 0), ('admin-2', 'admin', 0);
    INSERT INTO sessions VALUES
      ('session-a', 't-a', 'admin-1', ${NOW.getTime() + 7 * DAY}),
      ('session-b', 't-b', 'admin-1', ${NOW.getTime() + 7 * DAY}),
      ('session-short', 't-s', 'admin-1', ${NOW.getTime() + 60 * 60_000}),
      ('session-other', 't-o', 'admin-2', ${NOW.getTime() + 7 * DAY});
    INSERT INTO storefronts VALUES ('store-a');
    INSERT INTO storefront_themes VALUES ('theme-a', 'store-a', NULL);
  `);
  sqlite.exec(
    readFileSync(resolve("drizzle/0081_preview_access_grants.sql"), "utf8")
      .split("--> statement-breakpoint")
      .join("\n"),
  );
  vi.mocked(getDb).mockResolvedValue(drizzle(sqlite, { schema }) as never);
});

afterEach(() => sqlite.close());

const BINDER = "b".repeat(64);
const OTHER_BINDER = "c".repeat(64);

async function binderHash(binder = BINDER) {
  return hashPreviewAccessSecret(binder);
}

async function issue(
  overrides: Partial<Parameters<typeof issuePreviewAccessExchange>[0]> = {},
) {
  const issued = await issuePreviewAccessExchange({
    dal,
    kind: "iframe",
    sessionId: "session-a",
    userId: "admin-1",
    storefrontId: "store-a",
    themeId: "theme-a",
    previewId: "preview-a",
    previewHost: HOST,
    binderHash: await binderHash(),
    now: NOW,
    ...overrides,
  });
  if (!issued.ok) throw new Error(issued.reason);
  return issued;
}

const redeem = (
  code: string,
  overrides: Partial<Parameters<typeof redeemPreviewAccessExchange>[0]> = {},
) =>
  redeemPreviewAccessExchange({
    dal,
    code,
    binder: BINDER,
    previewHost: HOST,
    kind: "iframe",
    now: later(1000),
    ...overrides,
  });

async function grantToken(overrides: Parameters<typeof issue>[0] = {}) {
  const { code } = await issue(overrides);
  const redeemed = await redeem(code, {
    kind: overrides.kind ?? "iframe",
  });
  if (!redeemed.ok) throw new Error(redeemed.reason);
  return redeemed.token;
}

const verify = (token: string, now = later(2000), previewHost = HOST) =>
  verifyPreviewAccessGrant({ dal, token, previewHost, now });

describe("preview access exchange", () => {
  it("redeems a code once, in the browser holding the binder, for a grant that verifies", async () => {
    const { code, expiresAt } = await issue();
    expect(Date.parse(expiresAt) - NOW.getTime()).toBe(
      PREVIEW_ACCESS_EXCHANGE_TTL_MS,
    );

    const redeemed = await redeem(code);
    expect(redeemed.ok).toBe(true);
    if (!redeemed.ok) return;
    const verified = await verify(redeemed.token);
    expect(verified).toMatchObject({
      ok: true,
      grant: {
        kind: "iframe",
        sessionId: "session-a",
        userId: "admin-1",
        previewId: "preview-a",
        previewHost: HOST,
      },
    });

    expect(await redeem(code)).toEqual({
      ok: false,
      reason: "EXCHANGE_INVALID",
    });
  });

  it("refuses a code presented without its binder, and leaves it for the browser that has it", async () => {
    const { code } = await issue();

    expect(await redeem(code, { binder: OTHER_BINDER })).toEqual({
      ok: false,
      reason: "EXCHANGE_INVALID",
    });
    // The attempt consumed nothing: the owner still redeems.
    expect((await redeem(code)).ok).toBe(true);
  });

  it("refuses a code knowing only the binder's hash, not the binder", async () => {
    const hash = await binderHash();
    const { code } = await issue();
    expect(await redeem(code, { binder: hash })).toEqual({
      ok: false,
      reason: "EXCHANGE_INVALID",
    });
  });

  it("lets exactly one of two concurrent redeems of the same code through", async () => {
    const { code } = await issue();
    const results = await Promise.all([redeem(code), redeem(code)]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, reason: "EXCHANGE_INVALID" },
    ]);
    expect(
      sqlite
        .prepare("SELECT count(*) AS n FROM storefront_preview_access_grants")
        .get(),
    ).toEqual({ n: 1 });
  });

  it("refuses a code once it has expired", async () => {
    const { code } = await issue();
    expect(
      await redeem(code, { now: later(PREVIEW_ACCESS_EXCHANGE_TTL_MS) }),
    ).toEqual({ ok: false, reason: "EXCHANGE_INVALID" });
  });

  it("refuses a code whose session was signed out between issue and redeem", async () => {
    const { code } = await issue();
    sqlite.prepare("DELETE FROM sessions WHERE id = 'session-a'").run();
    expect(await redeem(code)).toEqual({
      ok: false,
      reason: "EXCHANGE_INVALID",
    });
  });

  it("refuses a code whose session expired before redeem", async () => {
    const { code } = await issue();
    sqlite
      .prepare("UPDATE sessions SET expires_at = ? WHERE id = 'session-a'")
      .run(NOW.getTime() + 500);
    expect(await redeem(code)).toEqual({
      ok: false,
      reason: "EXCHANGE_INVALID",
    });
  });

  it("refuses a code presented on another preview host or for another context", async () => {
    const { code } = await issue();
    expect(
      await redeem(code, { previewHost: "pv-preview-b.preview.example.test" }),
    ).toEqual({ ok: false, reason: "EXCHANGE_INVALID" });
    expect(await redeem(code, { kind: "tab" })).toEqual({
      ok: false,
      reason: "EXCHANGE_INVALID",
    });
    expect((await redeem(code)).ok).toBe(true);
  });

  it("issues no grant once the user lost the role or was banned before redeem", async () => {
    const { code } = await issue();
    sqlite.prepare("UPDATE users SET role = 'user' WHERE id = 'admin-1'").run();
    expect(await redeem(code)).toEqual({
      ok: false,
      reason: "USER_NOT_AUTHORIZED",
    });

    sqlite
      .prepare(
        "UPDATE users SET role = 'admin', banned = 1 WHERE id = 'admin-1'",
      )
      .run();
    const second = await issue();
    expect(await redeem(second.code)).toEqual({
      ok: false,
      reason: "USER_NOT_AUTHORIZED",
    });
    expect(
      sqlite
        .prepare("SELECT count(*) AS n FROM storefront_preview_access_grants")
        .get(),
    ).toEqual({ n: 0 });
  });

  it("refuses to issue for a malformed binder hash", async () => {
    expect(
      await issuePreviewAccessExchange({
        dal,
        kind: "iframe",
        sessionId: "session-a",
        userId: "admin-1",
        storefrontId: "store-a",
        themeId: "theme-a",
        previewId: "preview-a",
        previewHost: HOST,
        binderHash: "not-a-hash",
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "BINDER_INVALID" });
  });

  it("stores only hashes: no code, binder or token appears in either table", async () => {
    const { code } = await issue();
    const redeemed = await redeem(code);
    if (!redeemed.ok) throw new Error(redeemed.reason);
    const dump = JSON.stringify([
      sqlite.prepare("SELECT * FROM storefront_preview_access_exchanges").all(),
      sqlite.prepare("SELECT * FROM storefront_preview_access_grants").all(),
    ]);
    for (const secret of [code, BINDER, redeemed.token]) {
      expect(dump).not.toContain(secret);
    }
  });
});

describe("preview access grant", () => {
  it("expires no later than its session, and no later than the cap", async () => {
    const short = await grantToken({ sessionId: "session-short" });
    const shortGrant = await verify(short);
    expect(shortGrant.ok && Date.parse(shortGrant.grant.expiresAt)).toBe(
      NOW.getTime() + 60 * 60_000,
    );

    const long = await grantToken();
    const longGrant = await verify(long);
    expect(longGrant.ok && Date.parse(longGrant.grant.expiresAt)).toBe(
      later(1000).getTime() + PREVIEW_ACCESS_GRANT_MAX_MS,
    );
    expect(
      await verify(long, later(1000 + PREVIEW_ACCESS_GRANT_MAX_MS)),
    ).toEqual({ ok: false, reason: "GRANT_EXPIRED" });
  });

  it("is refused on the next check once its session is signed out, while the same user's other session keeps working", async () => {
    const a = await grantToken({ sessionId: "session-a" });
    const b = await grantToken({
      sessionId: "session-b",
      binderHash: await binderHash(),
    });
    sqlite.prepare("DELETE FROM sessions WHERE id = 'session-a'").run();

    expect(await verify(a)).toEqual({ ok: false, reason: "SESSION_ENDED" });
    expect((await verify(b)).ok).toBe(true);
  });

  it("is refused once its session has expired, without waiting for the grant to", async () => {
    const token = await grantToken({ sessionId: "session-short" });
    expect(await verify(token, later(60 * 60_000))).toEqual({
      ok: false,
      reason: "GRANT_EXPIRED",
    });
  });

  it("is refused for a session that now belongs to someone else", async () => {
    const token = await grantToken();
    sqlite
      .prepare("UPDATE sessions SET user_id = 'admin-2' WHERE id = 'session-a'")
      .run();
    expect(await verify(token)).toEqual({ ok: false, reason: "SESSION_ENDED" });
  });

  it("is refused after a ban or a role change", async () => {
    const token = await grantToken();
    sqlite.prepare("UPDATE users SET banned = 1 WHERE id = 'admin-1'").run();
    expect(await verify(token)).toEqual({
      ok: false,
      reason: "USER_NOT_AUTHORIZED",
    });
    sqlite
      .prepare(
        "UPDATE users SET banned = 0, role = 'guest' WHERE id = 'admin-1'",
      )
      .run();
    expect(await verify(token)).toEqual({
      ok: false,
      reason: "USER_NOT_AUTHORIZED",
    });
  });

  it("is refused once its Theme is removed", async () => {
    const token = await grantToken();
    sqlite
      .prepare(
        "UPDATE storefront_themes SET deleted_at = 't' WHERE id = 'theme-a'",
      )
      .run();
    expect(await verify(token)).toEqual({
      ok: false,
      reason: "THEME_NOT_LIVE",
    });
  });

  it("is refused on any other preview host", async () => {
    const token = await grantToken();
    expect(
      await verify(token, later(2000), "pv-preview-b.preview.example.test"),
    ).toEqual({ ok: false, reason: "HOST_MISMATCH" });
  });

  it("is refused for an unknown or malformed token", async () => {
    expect(await verify("0".repeat(64))).toEqual({
      ok: false,
      reason: "GRANT_UNKNOWN",
    });
    expect(await verify("short")).toEqual({
      ok: false,
      reason: "GRANT_UNKNOWN",
    });
  });

  it("revokes by session without touching another session, and by user for every session", async () => {
    const a = await grantToken({ sessionId: "session-a" });
    const b = await grantToken({ sessionId: "session-b" });
    const other = await grantToken({
      sessionId: "session-other",
      userId: "admin-2",
    });

    const bySession = await revokePreviewAccessForSession({
      dal,
      sessionId: "session-a",
      now: later(3000),
    });
    expect(bySession.map((grant) => grant.previewId)).toEqual(["preview-a"]);
    expect(await verify(a, later(4000))).toEqual({
      ok: false,
      reason: "GRANT_REVOKED",
    });
    expect((await verify(b, later(4000))).ok).toBe(true);

    await revokePreviewAccessForUser({
      dal,
      userId: "admin-1",
      now: later(5000),
    });
    expect(await verify(b, later(6000))).toEqual({
      ok: false,
      reason: "GRANT_REVOKED",
    });
    expect((await verify(other, later(6000))).ok).toBe(true);
  });
});
