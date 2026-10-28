import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { storefrontPreviewAccessDal as dal } from "../../dal/storefront-preview-access.dal";
import {
  PREVIEW_ACCESS_ACTIVATION_WINDOW_MS,
  PREVIEW_ACCESS_EXCHANGE_TTL_MS,
  createPreviewAccessSecret,
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

/** A fresh flow id, as the editor makes one per attempt. */
const newFlowId = () => createPreviewAccessSecret().slice(0, 32);

type Issued = Readonly<{ code: string; flowId: string; expiresAt: string }>;

async function issue(
  overrides: Partial<Parameters<typeof issuePreviewAccessExchange>[0]> = {},
): Promise<Issued> {
  const flowId = overrides.flowId ?? newFlowId();
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
    flowId,
  });
  if (!issued.ok) throw new Error(issued.reason);
  return { code: issued.code, flowId, expiresAt: issued.expiresAt };
}

const redeem = (
  issued: Pick<Issued, "code" | "flowId">,
  overrides: Partial<Parameters<typeof redeemPreviewAccessExchange>[0]> = {},
) =>
  redeemPreviewAccessExchange({
    dal,
    code: issued.code,
    flowId: issued.flowId,
    binder: BINDER,
    previewHost: HOST,
    kind: "iframe",
    now: later(1000),
    ...overrides,
  });

async function grantToken(overrides: Parameters<typeof issue>[0] = {}) {
  const issued = await issue(overrides);
  const redeemed = await redeem(issued, {
    kind: overrides.kind ?? "iframe",
  });
  if (!redeemed.ok) throw new Error(redeemed.reason);
  return redeemed.token;
}

const verify = (token: string, now = later(2000), previewHost = HOST) =>
  verifyPreviewAccessGrant({ dal, token, previewHost, now });

describe("preview access exchange", () => {
  it("redeems a code once, in the browser holding the binder, for a grant that verifies", async () => {
    const issued = await issue();
    expect(Date.parse(issued.expiresAt) - NOW.getTime()).toBe(
      PREVIEW_ACCESS_EXCHANGE_TTL_MS,
    );

    const redeemed = await redeem(issued);
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

    expect(await redeem(issued)).toEqual({
      ok: false,
      reason: "EXCHANGE_INVALID",
    });
  });

  it("refuses a code presented without its binder, and leaves it for the browser that has it", async () => {
    const issued = await issue();

    expect(await redeem(issued, { binder: OTHER_BINDER })).toEqual({
      ok: false,
      reason: "EXCHANGE_INVALID",
    });
    // The attempt consumed nothing: the owner still redeems.
    expect((await redeem(issued)).ok).toBe(true);
  });

  it("refuses a code knowing only the binder's hash, not the binder", async () => {
    const hash = await binderHash();
    const issued = await issue();
    expect(await redeem(issued, { binder: hash })).toEqual({
      ok: false,
      reason: "EXCHANGE_INVALID",
    });
  });

  it("lets exactly one of two concurrent redeems of the same code through", async () => {
    const issued = await issue();
    const results = await Promise.all([redeem(issued), redeem(issued)]);
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
    const issued = await issue();
    expect(
      await redeem(issued, { now: later(PREVIEW_ACCESS_EXCHANGE_TTL_MS) }),
    ).toEqual({ ok: false, reason: "EXCHANGE_INVALID" });
  });

  it("refuses a code whose session was signed out between issue and redeem", async () => {
    const issued = await issue();
    sqlite.prepare("DELETE FROM sessions WHERE id = 'session-a'").run();
    expect(await redeem(issued)).toEqual({
      ok: false,
      reason: "EXCHANGE_INVALID",
    });
  });

  it("refuses a code whose session expired before redeem", async () => {
    const issued = await issue();
    sqlite
      .prepare("UPDATE sessions SET expires_at = ? WHERE id = 'session-a'")
      .run(NOW.getTime() + 500);
    expect(await redeem(issued)).toEqual({
      ok: false,
      reason: "EXCHANGE_INVALID",
    });
  });

  it("refuses a code presented on another preview host or for another context", async () => {
    const issued = await issue();
    expect(
      await redeem(issued, {
        previewHost: "pv-preview-b.preview.example.test",
      }),
    ).toEqual({ ok: false, reason: "EXCHANGE_INVALID" });
    expect(await redeem(issued, { kind: "tab" })).toEqual({
      ok: false,
      reason: "EXCHANGE_INVALID",
    });
    expect((await redeem(issued)).ok).toBe(true);
  });

  it("issues no grant once the user lost the role or was banned before redeem", async () => {
    const issued = await issue();
    sqlite.prepare("UPDATE users SET role = 'user' WHERE id = 'admin-1'").run();
    expect(await redeem(issued)).toEqual({
      ok: false,
      reason: "USER_NOT_AUTHORIZED",
    });

    sqlite
      .prepare(
        "UPDATE users SET role = 'admin', banned = 1 WHERE id = 'admin-1'",
      )
      .run();
    const second = await issue();
    expect(await redeem(second)).toEqual({
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
        flowId: newFlowId(),
        binderHash: "not-a-hash",
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "BINDER_INVALID" });
  });

  it("stores only hashes: no code, binder or token appears in either table", async () => {
    const issued = await issue();
    const redeemed = await redeem(issued);
    if (!redeemed.ok) throw new Error(redeemed.reason);
    const dump = JSON.stringify([
      sqlite.prepare("SELECT * FROM storefront_preview_access_exchanges").all(),
      sqlite.prepare("SELECT * FROM storefront_preview_access_grants").all(),
    ]);
    for (const secret of [issued.code, BINDER, redeemed.token]) {
      expect(dump).not.toContain(secret);
    }
  });
});

describe("preview access flows", () => {
  it("refuses a code redeemed under another flow's id, and leaves both flows to redeem their own", async () => {
    const a = await issue();
    const b = await issue({ binderHash: await binderHash(OTHER_BINDER) });

    expect(await redeem(a, { flowId: b.flowId })).toEqual({
      ok: false,
      reason: "EXCHANGE_INVALID",
    });
    expect(await redeem(b, { flowId: a.flowId, binder: OTHER_BINDER })).toEqual(
      { ok: false, reason: "EXCHANGE_INVALID" },
    );
    expect((await redeem(a)).ok).toBe(true);
    expect((await redeem(b, { binder: OTHER_BINDER })).ok).toBe(true);
  });

  it("refuses a redeem presenting another flow's binder, and consumes nothing", async () => {
    const a = await issue();
    const b = await issue({ binderHash: await binderHash(OTHER_BINDER) });

    expect(await redeem(a, { binder: OTHER_BINDER })).toEqual({
      ok: false,
      reason: "EXCHANGE_INVALID",
    });
    expect(await redeem(b)).toEqual({ ok: false, reason: "EXCHANGE_INVALID" });
    expect((await redeem(a)).ok).toBe(true);
    expect((await redeem(b, { binder: OTHER_BINDER })).ok).toBe(true);
  });

  it("gives one flow one code: a second issue for it is refused and the first code still redeems", async () => {
    const first = await issue();
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
        flowId: first.flowId,
        binderHash: await binderHash(OTHER_BINDER),
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "FLOW_IN_USE" });
    expect((await redeem(first)).ok).toBe(true);
  });

  it("refuses to issue or redeem for a malformed flow id", async () => {
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
        flowId: "../not-a-flow",
        binderHash: await binderHash(),
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "FLOW_INVALID" });
    const issued = await issue();
    expect(await redeem(issued, { flowId: "short" })).toEqual({
      ok: false,
      reason: "EXCHANGE_INVALID",
    });
    expect((await redeem(issued)).ok).toBe(true);
  });

  it("redeems two flows of one session on one host at once, each with its own grant", async () => {
    const a = await issue();
    const b = await issue({ binderHash: await binderHash(OTHER_BINDER) });

    const [redeemedA, redeemedB] = await Promise.all([
      redeem(a),
      redeem(b, { binder: OTHER_BINDER }),
    ]);
    if (!redeemedA.ok || !redeemedB.ok) throw new Error("both should redeem");
    expect(redeemedA.grant.flowId).toBe(a.flowId);
    expect(redeemedB.grant.flowId).toBe(b.flowId);
    expect(redeemedA.grant.id).not.toBe(redeemedB.grant.id);
    expect((await verify(redeemedA.token)).ok).toBe(true);
    expect((await verify(redeemedB.token)).ok).toBe(true);
  });

  it("stores at most one grant per flow", async () => {
    const issued = await issue();
    const redeemed = await redeem(issued);
    if (!redeemed.ok) throw new Error(redeemed.reason);
    await expect(
      dal.insertGrant({
        ...redeemed.grant,
        id: "grant-again",
        tokenHash: await hashPreviewAccessSecret(createPreviewAccessSecret()),
        now: later(1500).toISOString(),
      }),
    ).rejects.toThrow();
  });

  it("keeps another tab's grant working when one tab's response is lost and another's grant fails to be created", async () => {
    // A working tab.
    const working = await grantToken();

    // A second tab redeems, but its 303 never arrives: the token is lost.
    const lost = await issue({ binderHash: await binderHash(OTHER_BINDER) });
    const lostRedeem = await redeem(lost, { binder: OTHER_BINDER });
    expect(lostRedeem.ok).toBe(true);

    // A third tab's grant cannot be created; the editor then starts one new
    // flow for that tab.
    const failing = await issue();
    const insert = vi
      .spyOn(dal, "insertGrant")
      .mockRejectedValueOnce(new Error("D1 unavailable"));
    expect(await redeem(failing)).toEqual({
      ok: false,
      reason: "GRANT_NOT_CREATED",
    });
    insert.mockRestore();
    const retried = await grantToken();

    expect((await verify(working, later(3000))).ok).toBe(true);
    expect((await verify(retried, later(3000))).ok).toBe(true);
    expect(
      sqlite
        .prepare(
          "SELECT count(*) AS n FROM storefront_preview_access_grants WHERE revoked_at IS NOT NULL",
        )
        .get(),
    ).toEqual({ n: 0 });
  });
});

describe("preview access grant activation", () => {
  const WINDOW = PREVIEW_ACCESS_ACTIVATION_WINDOW_MS;
  /** Grants in these tests are created by redeem at later(1000). */
  const CREATED = 1000;

  async function redeemed(overrides: Parameters<typeof issue>[0] = {}) {
    const issued = await issue(overrides);
    const result = await redeem(issued);
    if (!result.ok) throw new Error(result.reason);
    return result;
  }

  const row = (id: string) =>
    sqlite
      .prepare(
        "SELECT activated_at, expires_at, revoked_at FROM storefront_preview_access_grants WHERE id = ?",
      )
      .get(id) as {
      activated_at: string | null;
      expires_at: string;
      revoked_at: string | null;
    };

  it("is not activated by issuing or redeeming, only by the first request that verifies", async () => {
    const { token, grant } = await redeemed();
    expect(row(grant.id).activated_at).toBeNull();

    expect((await verify(token, later(2000))).ok).toBe(true);
    expect(row(grant.id).activated_at).toBe(later(2000).toISOString());
  });

  it("keeps its first activation time and its expiry however often it is used", async () => {
    const { token, grant } = await redeemed();
    await verify(token, later(2000));
    const first = row(grant.id);

    for (const at of [60_000, 10 * 60_000, 6 * 60 * 60_000]) {
      expect((await verify(token, later(at))).ok).toBe(true);
    }
    expect(row(grant.id)).toEqual(first);
    expect(await verify(token, new Date(first.expires_at))).toEqual({
      ok: false,
      reason: "GRANT_EXPIRED",
    });
  });

  it("activates just inside its window, is refused at and after it, and stays refused", async () => {
    const inside = await redeemed();
    const atEdge = await redeemed();

    expect((await verify(inside.token, later(CREATED + WINDOW - 1))).ok).toBe(
      true,
    );
    expect(await verify(atEdge.token, later(CREATED + WINDOW))).toEqual({
      ok: false,
      reason: "GRANT_NOT_ACTIVATED",
    });
    expect(await verify(atEdge.token, later(CREATED + 2 * WINDOW))).toEqual({
      ok: false,
      reason: "GRANT_NOT_ACTIVATED",
    });
    expect(row(atEdge.grant.id).activated_at).toBeNull();
    expect((await verify(inside.token, later(CREATED + 2 * WINDOW))).ok).toBe(
      true,
    );
  });

  it("is not activated by a request that is refused", async () => {
    const { token, grant } = await redeemed();
    expect(
      await verify(token, later(2000), "pv-preview-b.preview.example.test"),
    ).toEqual({ ok: false, reason: "HOST_MISMATCH" });
    sqlite.prepare("UPDATE users SET banned = 1 WHERE id = 'admin-1'").run();
    expect(await verify(token, later(3000))).toEqual({
      ok: false,
      reason: "USER_NOT_AUTHORIZED",
    });
    sqlite.prepare("UPDATE users SET banned = 0 WHERE id = 'admin-1'").run();
    expect(row(grant.id).activated_at).toBeNull();

    expect(await verify(token, later(CREATED + WINDOW))).toEqual({
      ok: false,
      reason: "GRANT_NOT_ACTIVATED",
    });
  });

  it("lets two concurrent first uses both through and keeps one activation time", async () => {
    const { token, grant } = await redeemed();
    const results = await Promise.all([
      verify(token, later(2000)),
      verify(token, later(3000)),
    ]);
    expect(results.map((result) => result.ok)).toEqual([true, true]);
    expect([later(2000).toISOString(), later(3000).toISOString()]).toContain(
      row(grant.id).activated_at,
    );
  });

  it("records activation once: a second activation keeps the first time", async () => {
    const { grant } = await redeemed();
    const activatableAfter = later(2000 - WINDOW).toISOString();
    expect(
      await dal.activateGrant({
        id: grant.id,
        activatableAfter,
        now: later(2000).toISOString(),
      }),
    ).toBe(true);
    expect(
      await dal.activateGrant({
        id: grant.id,
        activatableAfter,
        now: later(5000).toISOString(),
      }),
    ).toBe(true);
    expect(row(grant.id).activated_at).toBe(later(2000).toISOString());
  });

  it("refuses a first use whose grant was revoked after it was read", async () => {
    const { token, grant } = await redeemed();
    const original = dal.findGrantByTokenHash;
    const read = vi
      .spyOn(dal, "findGrantByTokenHash")
      .mockImplementationOnce(async (hash) => {
        const record = await original(hash);
        sqlite
          .prepare(
            "UPDATE storefront_preview_access_grants SET revoked_at = ? WHERE id = ?",
          )
          .run(later(1500).toISOString(), grant.id);
        return record;
      });
    expect(await verify(token, later(2000))).toEqual({
      ok: false,
      reason: "GRANT_NOT_ACTIVATED",
    });
    read.mockRestore();
    expect(row(grant.id).activated_at).toBeNull();
  });

  it("leaves a tab's grant in use alone while another tab's lost grant lapses and that tab recovers", async () => {
    const working = await redeemed();
    await verify(working.token, later(2000));
    const before = row(working.grant.id);

    // Another tab's 303 is lost: its grant is never used.
    const lostFlow = await issue({
      binderHash: await binderHash(OTHER_BINDER),
    });
    const lost = await redeem(lostFlow, { binder: OTHER_BINDER });
    if (!lost.ok) throw new Error(lost.reason);
    // That tab starts one new flow, and its new grant is used.
    const recovered = await redeemed();
    expect((await verify(recovered.token, later(3000))).ok).toBe(true);

    const after = later(CREATED + 2 * WINDOW);
    expect((await verify(working.token, after)).ok).toBe(true);
    expect((await verify(recovered.token, after)).ok).toBe(true);
    expect(await verify(lost.token, after)).toEqual({
      ok: false,
      reason: "GRANT_NOT_ACTIVATED",
    });
    expect(row(working.grant.id)).toEqual(before);
    expect(
      sqlite
        .prepare(
          "SELECT count(*) AS n FROM storefront_preview_access_grants WHERE revoked_at IS NOT NULL",
        )
        .get(),
    ).toEqual({ n: 0 });
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
