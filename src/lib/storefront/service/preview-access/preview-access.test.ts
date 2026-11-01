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
  verifyPreviewAccessCandidates,
  verifyPreviewAccessGrant,
} from "./preview-access";
import { PREVIEW_ACCESS_GRANT_COOKIE_PREFIX } from "./preview-access-cookies";
import {
  handlePreviewAccessRequest,
  parsePreviewAccessHost,
  previewAccessHostname,
  type PreviewAccessRequestDeps,
} from "./preview-access-request";

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

  it("refuses a first use whose grant expired after it was read, before it was activated", async () => {
    sqlite
      .prepare(
        "INSERT INTO sessions VALUES ('session-brief', 't-br', 'admin-1', ?)",
      )
      .run(NOW.getTime() + 61_000);
    const { token, grant } = await redeemed({ sessionId: "session-brief" });
    expect(grant.expiresAt).toBe(later(61_000).toISOString());

    // Read and checked at 60 s, still valid; activated at 62 s, expired. Both
    // inside the activation window.
    const readings = [later(60_000), later(62_000)];
    expect(
      await verifyPreviewAccessGrant({
        dal,
        token,
        previewHost: HOST,
        clock: () => readings.shift()!,
      }),
    ).toEqual({ ok: false, reason: "GRANT_NOT_ACTIVATED" });
    expect(readings).toEqual([]);
    expect(row(grant.id).activated_at).toBeNull();
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

/**
 * A request on the preview host may carry several grant cookies, one per flow
 * (addendum A3, A4): two tabs, a frame and a retry. Each is a full credential
 * for this host on its own; the server, not the browser's order, decides which
 * one serves the request (A4.1 rule 7, user decision 2026-11-01: reuse first,
 * overflow refused explicitly).
 */
describe("preview access request with several grants", () => {
  const candidates = (tokens: readonly string[], now = later(2000)) =>
    verifyPreviewAccessCandidates({ dal, tokens, previewHost: HOST, now });

  /** Fixed reorderings, so a failure names the order that broke. */
  function orders<T>(items: readonly T[]): T[][] {
    const reversed = [...items].reverse();
    const rotated = [...items.slice(1), items[0]!];
    const interleaved = [
      ...items.filter((_, i) => i % 2 === 1),
      ...items.filter((_, i) => i % 2 === 0),
    ];
    return [[...items], reversed, rotated, interleaved];
  }

  it("is served by the one valid grant among unknown, revoked, expired and never activated ones, in every order", async () => {
    const valid = await grantToken();
    expect((await verify(valid)).ok).toBe(true); // activated
    const revoked = await grantToken({ sessionId: "session-b" });
    await revokePreviewAccessForSession({
      dal,
      sessionId: "session-b",
      now: later(1500),
    });
    const expired = await grantToken({ sessionId: "session-short" });
    const unactivated = await grantToken();
    const unknown = createPreviewAccessSecret();
    const tokens = [unknown, revoked, valid, expired, unactivated];
    // Past session-short's expiry and unactivated's window; valid still holds.
    const at = later(2 * 60 * 60_000);

    for (const order of orders(tokens)) {
      const result = await candidates(order, at);
      expect(result, order.join(",")).toMatchObject({ ok: true });
      if (!result.ok) continue;
      const expected = await verify(valid, at);
      expect(expected.ok && result.grant.id).toBe(
        expected.ok && expected.grant.id,
      );
    }
  });

  it("always chooses the same grant of two valid ones, whatever order they arrive in", async () => {
    const first = await grantToken();
    const second = await grantToken({ sessionId: "session-b" });
    await verify(first);
    await verify(second);

    const chosen = new Set<string>();
    for (const order of orders([first, second])) {
      const result = await candidates(order);
      expect(result.ok).toBe(true);
      if (result.ok) chosen.add(result.grant.id);
    }
    expect(chosen.size).toBe(1);
  });

  it("prefers a grant already in use over one never used, and activates nothing it does not choose", async () => {
    const used = await grantToken();
    await verify(used);
    const fresh = await grantToken({ sessionId: "session-b" });

    const result = await candidates([fresh, used]);

    expect(result.ok).toBe(true);
    const freshRow = sqlite
      .prepare(
        "SELECT activated_at FROM storefront_preview_access_grants WHERE session_id = 'session-b'",
      )
      .get() as { activated_at: string | null };
    expect(freshRow.activated_at).toBeNull();
  });

  it("activates a never used grant when it is the only one that holds", async () => {
    const fresh = await grantToken();

    const result = await candidates([createPreviewAccessSecret(), fresh]);

    expect(result.ok).toBe(true);
    const row = sqlite
      .prepare("SELECT activated_at FROM storefront_preview_access_grants")
      .get() as { activated_at: string | null };
    expect(row.activated_at).not.toBeNull();
  });

  it("is refused when no candidate holds, with the newest one's reason", async () => {
    const token = await grantToken();
    await verify(token);
    await revokePreviewAccessForSession({
      dal,
      sessionId: "session-a",
      now: later(3000),
    });

    expect(
      await candidates([token, createPreviewAccessSecret()], later(4000)),
    ).toEqual({
      ok: false,
      reason: "GRANT_REVOKED",
    });
    expect(await candidates([])).toEqual({
      ok: false,
      reason: "GRANT_UNKNOWN",
    });
    expect(await candidates(["not-a-token"])).toEqual({
      ok: false,
      reason: "GRANT_UNKNOWN",
    });
  });

  it("is refused on another preview host even when every grant holds on its own", async () => {
    const token = await grantToken();

    expect(
      await verifyPreviewAccessCandidates({
        dal,
        tokens: [token],
        previewHost: "pv-preview-b.preview.example.test",
        now: later(2000),
      }),
    ).toEqual({ ok: false, reason: "HOST_MISMATCH" });
  });

  it("reads every candidate in one query, and checks a duplicated token once", async () => {
    const token = await grantToken();
    const lookups = vi.spyOn(dal, "findGrantsByTokenHashes");
    const others = Array.from({ length: 6 }, () => createPreviewAccessSecret());

    const result = await candidates([token, token, ...others]);

    expect(result.ok).toBe(true);
    expect(lookups).toHaveBeenCalledOnce();
    expect(lookups.mock.calls[0]![0]).toHaveLength(7);
    lookups.mockRestore();
  });

  it("refuses to look up more than 8 tokens at once rather than splitting them", async () => {
    await expect(
      dal.findGrantsByTokenHashes(
        Array.from({ length: 9 }, () => "a".repeat(64)),
      ),
    ).rejects.toThrow("PREVIEW_ACCESS_LOOKUP_TOO_LARGE");
  });
});

/**
 * #214 P2: the `pv-` preview host verifies every request against D1 before a
 * byte of the preview is sent, and fails closed.
 */
describe("a request on the pv- preview host", () => {
  const PARENT = "preview.example.test";
  const PREVIEW_ID = "0123456789abcdef0123456789abcdef";
  const PV_HOST = previewAccessHostname(PREVIEW_ID, PARENT);
  const DRAFT = "DRAFT-MARKER-7f3a";
  const APP_ORIGIN = "https://app.example.test";

  function deps(overrides: Partial<PreviewAccessRequestDeps> = {}) {
    const forwarded: Request[] = [];
    const value: PreviewAccessRequestDeps = {
      previewParentHostname: PARENT,
      dal,
      now: () => later(2000),
      isAppOrigin: (origin) => origin === APP_ORIGIN,
      stripCredentials: (request) => {
        const headers = new Headers(request.headers);
        headers.delete("cookie");
        return new Request(request, { headers });
      },
      forward: async (previewId, request) => {
        forwarded.push(request);
        return new Response(`<p>${DRAFT} ${previewId}</p>`, {
          headers: {
            "content-type": "text/html",
            "cache-control": "max-age=600",
          },
        });
      },
      ...overrides,
    };
    return { value, forwarded };
  }

  async function pvGrant(overrides: Parameters<typeof issue>[0] = {}) {
    const issued = await issue({
      previewHost: PV_HOST,
      previewId: PREVIEW_ID,
      ...overrides,
    });
    const redeemed = await redeem(issued, { previewHost: PV_HOST });
    if (!redeemed.ok) throw new Error(redeemed.reason);
    return { token: redeemed.token, flowId: issued.flowId };
  }

  const cookie = (...grants: Array<{ token: string; flowId: string }>) =>
    grants
      .map((g) => `${PREVIEW_ACCESS_GRANT_COOKIE_PREFIX}${g.flowId}=${g.token}`)
      .join("; ");

  const get = (path: string, headers: Record<string, string> = {}) =>
    new Request(`https://${PV_HOST}${path}`, { headers });

  it("names exactly one preview, under the configured preview host only", () => {
    expect(parsePreviewAccessHost(PV_HOST, PARENT)).toBe(PREVIEW_ID);
    expect(parsePreviewAccessHost(PV_HOST.toUpperCase() + ".", PARENT)).toBe(
      PREVIEW_ID,
    );
    expect(
      parsePreviewAccessHost(`pv-${PREVIEW_ID}.other.test`, PARENT),
    ).toBeNull();
    expect(parsePreviewAccessHost(`pv-short.${PARENT}`, PARENT)).toBeNull();
    expect(
      parsePreviewAccessHost(`5173-sandbox-token.${PARENT}`, PARENT),
    ).toBeNull();
    expect(
      parsePreviewAccessHost(`x.pv-${PREVIEW_ID}.${PARENT}`, PARENT),
    ).toBeNull();
    expect(parsePreviewAccessHost(PV_HOST, null)).toBeNull();
  });

  it("leaves a request for any other host to the rest of the Worker", async () => {
    const { value, forwarded } = deps();
    expect(
      await handlePreviewAccessRequest(
        new Request(`https://${PARENT}/`),
        value,
      ),
    ).toBeNull();
    expect(forwarded).toHaveLength(0);
  });

  it("serves a request carrying a grant that verifies, without its credentials, and never caches the answer", async () => {
    const grant = await pvGrant();
    const { value, forwarded } = deps();

    const res = await handlePreviewAccessRequest(
      get("/", { cookie: `${cookie(grant)}; theme_cart=1` }),
      value,
    );

    expect(res!.status).toBe(200);
    expect(await res!.text()).toContain(DRAFT);
    expect(res!.headers.get("cache-control")).toBe("private, no-store");
    expect(res!.headers.get("referrer-policy")).toBe("no-referrer");
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]!.headers.get("cookie")).toBeNull();
  });

  it("gives a copied address alone nothing: no cookie, no draft", async () => {
    const { value, forwarded } = deps();

    const res = await handlePreviewAccessRequest(get("/"), value);

    expect(res!.status).toBe(401);
    expect(await res!.text()).not.toContain(DRAFT);
    expect(forwarded).toHaveLength(0);
  });

  it("refuses the next request once the grant's session signs out, while the same user's other session keeps working", async () => {
    const mine = await pvGrant();
    const other = await pvGrant({ sessionId: "session-b" });
    const { value, forwarded } = deps({ now: () => later(5000) });
    sqlite.exec("DELETE FROM sessions WHERE id = 'session-a'");

    const refused = await handlePreviewAccessRequest(
      get("/", { cookie: cookie(mine) }),
      value,
    );
    const served = await handlePreviewAccessRequest(
      get("/", { cookie: cookie(other) }),
      value,
    );

    expect(refused!.status).toBe(403);
    expect(await refused!.text()).not.toContain(DRAFT);
    expect(served!.status).toBe(200);
    expect(forwarded).toHaveLength(1);
  });

  it("refuses a grant after a ban or a role change", async () => {
    const grant = await pvGrant();
    const { value } = deps({ now: () => later(5000) });
    sqlite.exec("UPDATE users SET role = 'guest' WHERE id = 'admin-1'");

    const res = await handlePreviewAccessRequest(
      get("/", { cookie: cookie(grant) }),
      value,
    );

    expect(res!.status).toBe(403);
    expect(await res!.text()).not.toContain(DRAFT);
  });

  it("refuses a grant issued for another preview host", async () => {
    const elsewhere = previewAccessHostname("f".repeat(32), PARENT);
    const issued = await issue({
      previewHost: elsewhere,
      previewId: "f".repeat(32),
    });
    const redeemed = await redeem(issued, { previewHost: elsewhere });
    if (!redeemed.ok) throw new Error(redeemed.reason);
    const { value, forwarded } = deps();

    const res = await handlePreviewAccessRequest(
      get("/", {
        cookie: cookie({ token: redeemed.token, flowId: issued.flowId }),
      }),
      value,
    );

    expect(res!.status).toBe(403);
    expect(forwarded).toHaveLength(0);
  });

  it("refuses an over-full cookie set explicitly rather than serving from part of it", async () => {
    const grant = await pvGrant();
    const forged = Array.from({ length: 8 }, () => ({
      token: createPreviewAccessSecret(),
      flowId: newFlowId(),
    }));
    const { value, forwarded } = deps();

    const res = await handlePreviewAccessRequest(
      get("/", { cookie: cookie(grant, ...forged) }),
      value,
    );

    expect(res!.status).toBe(431);
    expect(await res!.text()).toContain("Too many preview sign-ins");
    expect(forwarded).toHaveLength(0);
  });

  it("fails closed when D1 cannot be read: 503, nothing forwarded", async () => {
    const grant = await pvGrant();
    const failing = {
      ...dal,
      findGrantsByTokenHashes: async () => {
        throw new Error("D1_ERROR");
      },
    } as typeof dal;
    const { value, forwarded } = deps({ dal: failing });

    const res = await handlePreviewAccessRequest(
      get("/", { cookie: cookie(grant) }),
      value,
    );

    expect(res!.status).toBe(503);
    expect(forwarded).toHaveLength(0);
  });

  it("answers a preview that is not running with 503, not with another handler", async () => {
    const grant = await pvGrant();
    const { value } = deps({ forward: async () => null });

    const res = await handlePreviewAccessRequest(
      get("/", { cookie: cookie(grant) }),
      value,
    );

    expect(res!.status).toBe(503);
  });

  it("keeps the authorization flow's path away from the Theme", async () => {
    const grant = await pvGrant();
    const { value, forwarded } = deps();

    const res = await handlePreviewAccessRequest(
      get("/__morph/preview-auth/elsewhere", { cookie: cookie(grant) }),
      value,
    );

    expect(res!.status).toBe(404);
    expect(forwarded).toHaveLength(0);
  });
});

/**
 * #214 P2: the authorization flow on the pv- host, end to end against the
 * real tables: begin sets the binder and reports only its hash; the editor is
 * issued a code for that hash; redeem consumes it with the binder the browser
 * presents and sets the grant; the next request is served by it.
 */
describe("the pv- authorization flow", () => {
  const PARENT = "preview.example.test";
  const PREVIEW_ID = "fedcba9876543210fedcba9876543210";
  const PV_HOST = previewAccessHostname(PREVIEW_ID, PARENT);
  const PV_ORIGIN = `https://${PV_HOST}`;
  const APP_ORIGIN = "https://app.example.test";
  const RETURN =
    "/?editorOrigin=https%3A%2F%2Fapp.example.test&previewSession=s1";

  const deps = (overrides: Partial<PreviewAccessRequestDeps> = {}) => ({
    previewParentHostname: PARENT,
    dal,
    now: () => later(1000),
    isAppOrigin: (origin: string) => origin === APP_ORIGIN,
    stripCredentials: (request: Request) => {
      const headers = new Headers(request.headers);
      headers.delete("cookie");
      return new Request(request, { headers });
    },
    forward: async () => new Response("<p>DRAFT</p>"),
    ...overrides,
  });

  const beginUrl = (flowId: string, extra: Record<string, string> = {}) => {
    const url = new URL("/__morph/preview-auth/begin", PV_ORIGIN);
    url.searchParams.set("flow", flowId);
    url.searchParams.set("return", RETURN);
    url.searchParams.set("editorOrigin", APP_ORIGIN);
    for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
    return url;
  };

  /** What a browser keeps from Set-Cookie: name → value, Max-Age 0 removes. */
  function jarFrom(response: Response, jar = new Map<string, string>()) {
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split("; ");
      const [name, value] = [
        pair!.slice(0, pair!.indexOf("=")),
        pair!.slice(pair!.indexOf("=") + 1),
      ];
      if (attrs.includes("Max-Age=0")) jar.delete(name);
      else jar.set(name, value);
    }
    return jar;
  }
  const cookieHeader = (jar: Map<string, string>) =>
    [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

  async function begin(flowId: string, jar = new Map<string, string>()) {
    const res = await handlePreviewAccessRequest(
      new Request(beginUrl(flowId)),
      deps(),
    );
    expect(res!.status).toBe(200);
    const html = await res!.text();
    const binderHashValue = /"binderHash":"([0-9a-f]{64})"/.exec(html)![1]!;
    return {
      res: res!,
      html,
      binderHash: binderHashValue,
      jar: jarFrom(res!, jar),
    };
  }

  async function issueFor(
    flowId: string,
    binderHashValue: string,
    sessionId = "session-a",
  ) {
    const issued = await issuePreviewAccessExchange({
      dal,
      kind: "iframe",
      sessionId,
      userId: "admin-1",
      storefrontId: "store-a",
      themeId: "theme-a",
      previewId: PREVIEW_ID,
      previewHost: PV_HOST,
      flowId,
      binderHash: binderHashValue,
      now: NOW,
    });
    if (!issued.ok) throw new Error(issued.reason);
    return issued.code;
  }

  const redeemRequest = (
    fields: Record<string, string>,
    jar: Map<string, string>,
    origin = PV_ORIGIN,
  ) =>
    new Request(new URL("/__morph/preview-auth/redeem", PV_ORIGIN), {
      method: "POST",
      headers: {
        origin,
        cookie: cookieHeader(jar),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(fields).toString(),
    });

  const grantCount = () =>
    (
      sqlite
        .prepare("SELECT count(*) AS n FROM storefront_preview_access_grants")
        .get() as { n: number }
    ).n;

  it("begins with a binder cookie the page never reveals, and tells only the editor its hash", async () => {
    const flowId = newFlowId();
    const { res, html, binderHash: reported, jar } = await begin(flowId);

    const binder = jar.get(`__Host-morph-pvb-${flowId}`)!;
    expect(binder).toMatch(/^[0-9a-f]{64}$/);
    expect(html).not.toContain(binder);
    expect(reported).toBe(await hashPreviewAccessSecret(binder));
    const setCookie = res.headers.getSetCookie()[0]!;
    for (const attribute of [
      "Secure",
      "HttpOnly",
      "SameSite=None",
      "Partitioned",
      "Path=/",
      "Max-Age=120",
    ]) {
      expect(setCookie).toContain(attribute);
    }
    expect(res.headers.get("content-security-policy")).toContain(
      `frame-ancestors ${APP_ORIGIN}`,
    );
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it.each([
    ["a malformed flow", { flow: "nope" }],
    ["another origin to return to", { return: "//evil.test/" }],
    ["an absolute return", { return: "https://evil.test/" }],
    [
      "an editor origin Morph does not own",
      { editorOrigin: "https://evil.test" },
    ],
  ])("refuses to begin with %s", async (_name, extra) => {
    const res = await handlePreviewAccessRequest(
      new Request(beginUrl(newFlowId(), extra)),
      deps(),
    );
    expect(res!.status).toBe(400);
    expect(res!.headers.getSetCookie()).toEqual([]);
  });

  it("redeems the editor's code with the browser's binder, sets the grant, and the next request is served", async () => {
    const flowId = newFlowId();
    const { binderHash: reported, jar } = await begin(flowId);
    const code = await issueFor(flowId, reported);

    const redeemed = await handlePreviewAccessRequest(
      redeemRequest(
        { flow: flowId, return: RETURN, editorOrigin: APP_ORIGIN, code },
        jar,
      ),
      deps(),
    );

    expect(redeemed!.status).toBe(303);
    expect(redeemed!.headers.get("location")).toBe(RETURN);
    jarFrom(redeemed!, jar);
    expect(jar.has(`__Host-morph-pvb-${flowId}`)).toBe(false);
    expect(jar.get(`__Host-morph-pv-${flowId}`)).toMatch(/^[0-9a-f]{64}$/);

    const page = await handlePreviewAccessRequest(
      new Request(new URL(RETURN, PV_ORIGIN), {
        headers: { cookie: cookieHeader(jar) },
      }),
      deps({ now: () => later(1500) }),
    );
    expect(page!.status).toBe(200);
    expect(await page!.text()).toContain("DRAFT");
  });

  it("refuses a code redeemed without this browser's binder, and leaves it for the browser that has it", async () => {
    const flowId = newFlowId();
    const { binderHash: reported, jar } = await begin(flowId);
    const code = await issueFor(flowId, reported);

    const stolen = await handlePreviewAccessRequest(
      redeemRequest(
        { flow: flowId, return: RETURN, editorOrigin: APP_ORIGIN, code },
        new Map(),
      ),
      deps(),
    );
    expect(stolen!.status).toBe(403);
    expect(await stolen!.text()).toContain("morph:preview-auth-failed");
    expect(
      stolen!.headers
        .getSetCookie()
        .some((c) => c.startsWith("__Host-morph-pv-")),
    ).toBe(false);

    const owner = await handlePreviewAccessRequest(
      redeemRequest(
        { flow: flowId, return: RETURN, editorOrigin: APP_ORIGIN, code },
        jar,
      ),
      deps(),
    );
    expect(owner!.status).toBe(303);
  });

  it("refuses a redeem posted from another origin", async () => {
    const flowId = newFlowId();
    const { binderHash: reported, jar } = await begin(flowId);
    const code = await issueFor(flowId, reported);

    const res = await handlePreviewAccessRequest(
      redeemRequest(
        { flow: flowId, return: RETURN, editorOrigin: APP_ORIGIN, code },
        jar,
        "https://evil.test",
      ),
      deps(),
    );

    expect(res!.status).toBe(403);
    expect(grantCount()).toBe(0);
  });

  it("reuses the grant this browser already holds for the same session, creating no grant and no cookie", async () => {
    const first = newFlowId();
    const one = await begin(first);
    const firstRedeem = await handlePreviewAccessRequest(
      redeemRequest(
        {
          flow: first,
          return: RETURN,
          editorOrigin: APP_ORIGIN,
          code: await issueFor(first, one.binderHash),
        },
        one.jar,
      ),
      deps(),
    );
    jarFrom(firstRedeem!, one.jar);
    // Used once, so activated.
    await handlePreviewAccessRequest(
      new Request(new URL("/", PV_ORIGIN), {
        headers: { cookie: cookieHeader(one.jar) },
      }),
      deps({ now: () => later(1500) }),
    );
    expect(grantCount()).toBe(1);

    const second = newFlowId();
    const two = await begin(second, one.jar);
    const res = await handlePreviewAccessRequest(
      redeemRequest(
        {
          flow: second,
          return: RETURN,
          editorOrigin: APP_ORIGIN,
          code: await issueFor(second, two.binderHash),
        },
        two.jar,
      ),
      deps({ now: () => later(2000) }),
    );

    expect(res!.status).toBe(303);
    expect(grantCount()).toBe(1);
    expect(
      res!.headers
        .getSetCookie()
        .some(
          (c) =>
            c.startsWith(`__Host-morph-pv-${second}=`) &&
            !c.includes("Max-Age=0"),
        ),
    ).toBe(false);
  });

  it("does not reuse another session's grant", async () => {
    const first = newFlowId();
    const one = await begin(first);
    jarFrom(
      (await handlePreviewAccessRequest(
        redeemRequest(
          {
            flow: first,
            return: RETURN,
            editorOrigin: APP_ORIGIN,
            code: await issueFor(first, one.binderHash, "session-b"),
          },
          one.jar,
        ),
        deps(),
      ))!,
      one.jar,
    );
    await handlePreviewAccessRequest(
      new Request(new URL("/", PV_ORIGIN), {
        headers: { cookie: cookieHeader(one.jar) },
      }),
      deps({ now: () => later(1500) }),
    );

    const second = newFlowId();
    const two = await begin(second, one.jar);
    const res = await handlePreviewAccessRequest(
      redeemRequest(
        {
          flow: second,
          return: RETURN,
          editorOrigin: APP_ORIGIN,
          code: await issueFor(second, two.binderHash, "session-a"),
        },
        two.jar,
      ),
      deps({ now: () => later(2000) }),
    );

    expect(res!.status).toBe(303);
    expect(grantCount()).toBe(2);
  });
});
