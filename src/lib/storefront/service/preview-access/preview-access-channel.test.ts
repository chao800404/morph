import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { storefrontPreviewAccessDal as dal } from "../../dal/storefront-preview-access.dal";
import {
  activatePreviewAccessFlowGrant,
  createPreviewAccessSecret,
  hashPreviewAccessSecret,
  issuePreviewAccessExchange,
  redeemPreviewAccessExchange,
  revokePreviewAccessForSession,
  verifyPreviewAccessChannel,
} from "./preview-access";
import { PREVIEW_ACCESS_GRANT_COOKIE_PREFIX } from "./preview-access-cookies";
import {
  handlePreviewAccessRequest,
  previewAccessHostname,
  type PreviewAccessRequestDeps,
} from "./preview-access-request";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ getDb: vi.fn() }));

/**
 * The preview host's answer to "did this editor, with this session, open this
 * frame?" (the channel binding a document with no channel in its URL asks
 * before it talks to an editor). It is answered from the exchange the frame's
 * flow redeemed, and only for the very grant that exchange ended in, checked
 * live: a revoked session, a different grant, a tab grant or an unbound flow
 * all fail closed.
 */

let sqlite: Database.Database;
const NOW = new Date("2026-11-27T00:00:00.000Z");
const later = (ms: number) => new Date(NOW.getTime() + ms);
const DAY = 24 * 60 * 60_000;
const PARENT = "preview.example.test";
const PREVIEW_ID = "a".repeat(32);
const HOST = previewAccessHostname(PREVIEW_ID, PARENT);
const EDITOR = "https://editor.example.test";
const SESSION = "11111111-1111-4111-8111-111111111111";
const BINDER = "b".repeat(64);

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
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
    INSERT INTO users VALUES ('admin-1', 'admin', 0);
    INSERT INTO sessions VALUES
      ('session-a', 't-a', 'admin-1', ${NOW.getTime() + 7 * DAY}),
      ('session-b', 't-b', 'admin-1', ${NOW.getTime() + 7 * DAY});
    INSERT INTO storefronts VALUES ('store-a');
    INSERT INTO storefront_themes VALUES ('theme-a', 'store-a', NULL);
  `);
  for (const migration of [
    "drizzle/0081_preview_access_grants.sql",
    "drizzle/0082_preview_access_resolved_grant.sql",
    "drizzle/0084_preview_access_channel_binding.sql",
  ]) {
    sqlite.exec(
      readFileSync(resolve(migration), "utf8")
        .split("--> statement-breakpoint")
        .join("\n"),
    );
  }
  vi.mocked(getDb).mockResolvedValue(drizzle(sqlite, { schema }) as never);
});

afterEach(() => sqlite.close());

const newFlowId = () => createPreviewAccessSecret().slice(0, 32);
const sha256 = hashPreviewAccessSecret;

async function framedGrant(
  overrides: {
    kind?: "iframe" | "tab";
    flowId?: string;
    editorOrigin?: string | null;
    previewSession?: string | null;
    sessionId?: string;
    reuse?: readonly string[];
  } = {},
) {
  const flowId = overrides.flowId ?? newFlowId();
  const kind = overrides.kind ?? "iframe";
  const bound = overrides.previewSession !== null;
  const issued = await issuePreviewAccessExchange({
    dal,
    kind,
    sessionId: overrides.sessionId ?? "session-a",
    userId: "admin-1",
    storefrontId: "store-a",
    themeId: "theme-a",
    previewId: PREVIEW_ID,
    previewHost: HOST,
    flowId,
    binderHash: await sha256(BINDER),
    ...(bound
      ? {
          editorOrigin: overrides.editorOrigin ?? EDITOR,
          previewSessionHash: await sha256(overrides.previewSession ?? SESSION),
        }
      : {}),
    now: NOW,
  });
  if (!issued.ok) throw new Error(issued.reason);
  const redeemed = await redeemPreviewAccessExchange({
    dal,
    flowId,
    code: issued.code,
    binder: BINDER,
    previewHost: HOST,
    kind,
    now: later(1000),
    ...(overrides.reuse
      ? { reuse: { tokens: overrides.reuse, minRemainingMs: 0 } }
      : {}),
  });
  if (!redeemed.ok) throw new Error(redeemed.reason);
  return {
    flowId,
    token: redeemed.token ?? overrides.reuse![0]!,
    grant: redeemed.grant,
  };
}

async function activate(token: string) {
  // The document that carries the channel request was itself served.
  const { verifyPreviewAccessGrant } = await import("./preview-access");
  const result = await verifyPreviewAccessGrant({
    dal,
    token,
    previewHost: HOST,
    now: later(2000),
  });
  if (!result.ok) throw new Error(result.reason);
}

const ask = (
  input: Partial<Parameters<typeof verifyPreviewAccessChannel>[0]> & {
    tokens: readonly string[];
    flowId: string;
  },
) =>
  verifyPreviewAccessChannel({
    dal,
    previewHost: HOST,
    editorOrigin: EDITOR,
    previewSession: SESSION,
    now: later(3000),
    ...input,
  });

describe("verifyPreviewAccessChannel", () => {
  it("agrees for the editor, session and grant the flow was bound to", async () => {
    const { flowId, token, grant } = await framedGrant();
    await activate(token);
    const answer = await ask({ flowId, tokens: [token] });
    expect(answer).toMatchObject({ ok: true, grant: { id: grant.id } });
  });

  it("activates the flow's own grant when no earlier request did", async () => {
    // The page may have been served under an older grant the browser also
    // held; the grant this flow redeemed is first presented here.
    const { flowId, token } = await framedGrant();
    expect(await ask({ flowId, tokens: [token] })).toMatchObject({ ok: true });
    const row = sqlite
      .prepare("SELECT activated_at FROM storefront_preview_access_grants")
      .get() as { activated_at: string | null };
    expect(row.activated_at).not.toBeNull();
  });

  it("refuses a grant first presented after its activation window", async () => {
    const { flowId, token } = await framedGrant();
    expect(
      await ask({ flowId, tokens: [token], now: later(1000 + 121_000) }),
    ).toEqual({ ok: false, reason: "GRANT_NOT_ACTIVATED" });
  });

  it("refuses another editor origin", async () => {
    const { flowId, token } = await framedGrant();
    await activate(token);
    expect(
      await ask({
        flowId,
        tokens: [token],
        editorOrigin: "https://evil.example.test",
      }),
    ).toEqual({ ok: false, reason: "CHANNEL_NOT_BOUND" });
  });

  it("refuses another session, even one that is well formed", async () => {
    const { flowId, token } = await framedGrant();
    await activate(token);
    expect(
      await ask({
        flowId,
        tokens: [token],
        previewSession: "22222222-2222-4222-8222-222222222222",
      }),
    ).toEqual({ ok: false, reason: "CHANNEL_NOT_BOUND" });
  });

  it("refuses a flow nobody bound, and one that never existed", async () => {
    const unbound = await framedGrant({ previewSession: null });
    await activate(unbound.token);
    expect(
      await ask({ flowId: unbound.flowId, tokens: [unbound.token] }),
    ).toEqual({
      ok: false,
      reason: "CHANNEL_NOT_BOUND",
    });
    expect(await ask({ flowId: newFlowId(), tokens: [unbound.token] })).toEqual(
      {
        ok: false,
        reason: "CHANNEL_NOT_BOUND",
      },
    );
  });

  it("refuses a flow whose code was never redeemed", async () => {
    const flowId = newFlowId();
    const issued = await issuePreviewAccessExchange({
      dal,
      kind: "iframe",
      sessionId: "session-a",
      userId: "admin-1",
      storefrontId: "store-a",
      themeId: "theme-a",
      previewId: PREVIEW_ID,
      previewHost: HOST,
      flowId,
      binderHash: await sha256(BINDER),
      editorOrigin: EDITOR,
      previewSessionHash: await sha256(SESSION),
      now: NOW,
    });
    expect(issued.ok).toBe(true);
    const other = await framedGrant();
    await activate(other.token);
    expect(await ask({ flowId, tokens: [other.token] })).toEqual({
      ok: false,
      reason: "CHANNEL_NOT_BOUND",
    });
  });

  it("refuses a valid grant that belongs to a different flow", async () => {
    const mine = await framedGrant();
    const other = await framedGrant();
    await activate(mine.token);
    await activate(other.token);
    expect(await ask({ flowId: mine.flowId, tokens: [other.token] })).toEqual({
      ok: false,
      reason: "CHANNEL_NOT_BOUND",
    });
  });

  it("agrees when the flow's grant is among several the browser sends", async () => {
    const mine = await framedGrant();
    const other = await framedGrant();
    await activate(mine.token);
    await activate(other.token);
    expect(
      await ask({ flowId: mine.flowId, tokens: [other.token, mine.token] }),
    ).toMatchObject({ ok: true, grant: { id: mine.grant.id } });
  });

  it("refuses a tab grant, whoever asks", async () => {
    const tab = await framedGrant({ kind: "tab" });
    await activate(tab.token);
    expect(await ask({ flowId: tab.flowId, tokens: [tab.token] })).toEqual({
      ok: false,
      reason: "CHANNEL_NOT_BOUND",
    });
  });

  it("refuses once the grant was revoked between the document's load and the check", async () => {
    const { flowId, token } = await framedGrant();
    await activate(token);
    expect(await ask({ flowId, tokens: [token] })).toMatchObject({ ok: true });
    await revokePreviewAccessForSession({
      dal,
      sessionId: "session-a",
      now: later(2500),
    });
    expect(await ask({ flowId, tokens: [token] })).toEqual({
      ok: false,
      reason: "GRANT_REVOKED",
    });
  });

  it("refuses when the editor's own session ended", async () => {
    const { flowId, token } = await framedGrant();
    await activate(token);
    sqlite.exec("DELETE FROM sessions WHERE id = 'session-a'");
    expect(await ask({ flowId, tokens: [token] })).toEqual({
      ok: false,
      reason: "SESSION_ENDED",
    });
  });

  it("refuses an expired grant", async () => {
    const { flowId, token } = await framedGrant();
    await activate(token);
    expect(
      await ask({ flowId, tokens: [token], now: later(13 * 60 * 60_000) }),
    ).toEqual({ ok: false, reason: "GRANT_EXPIRED" });
  });

  it("refuses on another preview host", async () => {
    const { flowId, token } = await framedGrant();
    await activate(token);
    expect(
      await ask({
        flowId,
        tokens: [token],
        previewHost: previewAccessHostname("c".repeat(32), PARENT),
      }),
    ).toEqual({ ok: false, reason: "CHANNEL_NOT_BOUND" });
  });

  it("refuses with no credential at all", async () => {
    const { flowId } = await framedGrant();
    expect(await ask({ flowId, tokens: [] })).toEqual({
      ok: false,
      reason: "GRANT_UNKNOWN",
    });
  });

  it("refuses an exchange recorded before the binding existed", async () => {
    const { flowId, token } = await framedGrant();
    await activate(token);
    sqlite.exec(
      "UPDATE storefront_preview_access_exchanges SET editor_origin = NULL, session_hash = NULL",
    );
    expect(await ask({ flowId, tokens: [token] })).toEqual({
      ok: false,
      reason: "CHANNEL_NOT_BOUND",
    });
  });
});

describe("migration 0084 on an existing database", () => {
  it("keeps the exchanges recorded before it, binding nothing for them", () => {
    const old = new Database(":memory:");
    try {
      old.pragma("foreign_keys = ON");
      old.exec(`
        CREATE TABLE storefronts (id text PRIMARY KEY);
        CREATE TABLE storefront_themes (
          id text PRIMARY KEY, storefront_id text NOT NULL, deleted_at text
        );
        INSERT INTO storefronts VALUES ('store-a');
        INSERT INTO storefront_themes VALUES ('theme-a', 'store-a', NULL);
      `);
      const run = (file: string) =>
        old.exec(
          readFileSync(resolve(file), "utf8")
            .split("--> statement-breakpoint")
            .join("\n"),
        );
      run("drizzle/0081_preview_access_grants.sql");
      run("drizzle/0082_preview_access_resolved_grant.sql");
      old.exec(`
        INSERT INTO storefront_preview_access_exchanges
          (id, flow_id, code_hash, binder_hash, kind, session_id, user_id,
           storefront_id, theme_id, preview_id, preview_host, expires_at,
           consumed_at, resolved_grant_id, created_at, updated_at)
        VALUES ('x1', '${"1".repeat(32)}', 'c', 'b', 'iframe', 's', 'u',
           'store-a', 'theme-a', 'p', 'h', '2026-01-01', '2026-01-01',
           'grant-1', '2026-01-01', '2026-01-01');
      `);
      run("drizzle/0084_preview_access_channel_binding.sql");
      expect(
        old
          .prepare(
            "SELECT resolved_grant_id AS grant, editor_origin AS origin, session_hash AS hash FROM storefront_preview_access_exchanges",
          )
          .all(),
      ).toEqual([{ grant: "grant-1", origin: null, hash: null }]);
    } finally {
      old.close();
    }
  });
});

describe("the preview host's channel page", () => {
  const CHANNEL = `https://${HOST}/__morph/preview-auth/channel`;

  function deps(overrides: Partial<PreviewAccessRequestDeps> = {}) {
    return {
      previewParentHostname: PARENT,
      dal,
      forward: vi.fn(async () => new Response("theme")),
      stripCredentials: (request: Request) => request,
      isAppOrigin: (origin: string) => origin === EDITOR,
      now: () => later(3000),
      ...overrides,
    } satisfies PreviewAccessRequestDeps;
  }

  const post = (
    _unused: null,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    new Request(CHANNEL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: `https://${HOST}`,
        "sec-fetch-site": "same-origin",
        ...headers,
      },
      body: JSON.stringify(body),
    });

  const cookieFor = async (token: string) =>
    `${PREVIEW_ACCESS_GRANT_COOKIE_PREFIX}${(await sha256(token)).slice(0, 32)}=${token}`;

  it("answers ok for the bound editor and flow, and never reaches the Theme", async () => {
    const { flowId, token } = await framedGrant();
    await activate(token);
    const d = deps();
    const response = await handlePreviewAccessRequest(
      post(
        null,
        { flowId, editorOrigin: EDITOR, previewSession: SESSION },
        {
          cookie: await cookieFor(token),
        },
      ),
      d,
    );
    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true });
    expect(response?.headers.get("cache-control")).toBe("private, no-store");
    expect(d.forward).not.toHaveBeenCalled();
  });

  it("refuses an editor origin that is not one of Morph's own", async () => {
    const { flowId, token } = await framedGrant({
      editorOrigin: "https://evil.example.test",
    });
    await activate(token);
    const response = await handlePreviewAccessRequest(
      post(
        null,
        {
          flowId,
          editorOrigin: "https://evil.example.test",
          previewSession: SESSION,
        },
        {
          cookie: await cookieFor(token),
        },
      ),
      deps(),
    );
    expect(response?.status).toBe(403);
    expect(await response?.json()).toEqual({ ok: false });
  });

  it("refuses a request that is not the preview's own page asking", async () => {
    const { flowId, token } = await framedGrant();
    await activate(token);
    const cookie = await cookieFor(token);
    const body = { flowId, editorOrigin: EDITOR, previewSession: SESSION };
    for (const headers of [
      { origin: "https://other.example.test", "sec-fetch-site": "cross-site" },
      { origin: EDITOR, "sec-fetch-site": "cross-site" },
    ]) {
      const response = await handlePreviewAccessRequest(
        post(null, body, { cookie, ...headers }),
        deps(),
      );
      expect(response?.status).toBe(403);
    }
    const get = await handlePreviewAccessRequest(
      new Request(CHANNEL, { method: "GET", headers: { cookie } }),
      deps(),
    );
    expect(get?.status).toBe(405);
  });

  it("refuses a body that is malformed, without reading any grant", async () => {
    const { token } = await framedGrant();
    const cookie = await cookieFor(token);
    for (const body of [
      {},
      { flowId: "x", editorOrigin: EDITOR, previewSession: SESSION },
      { flowId: newFlowId(), editorOrigin: EDITOR, previewSession: "nope" },
      {
        flowId: newFlowId(),
        editorOrigin: `${EDITOR}/path`,
        previewSession: SESSION,
      },
    ]) {
      const response = await handlePreviewAccessRequest(
        post(null, body, { cookie }),
        deps(),
      );
      expect(response?.status).toBe(400);
    }
  });

  it("refuses with no cookie, and does not set one", async () => {
    const { flowId } = await framedGrant();
    const response = await handlePreviewAccessRequest(
      post(null, { flowId, editorOrigin: EDITOR, previewSession: SESSION }),
      deps(),
    );
    expect(response?.status).toBe(403);
    expect(response?.headers.get("set-cookie")).toBeNull();
  });
});

describe("activating the grant a flow just redeemed", () => {
  const ACTIVATE = `https://${HOST}/__morph/preview-auth/activate`;
  const cookieFor = async (...tokens: string[]) =>
    (
      await Promise.all(
        tokens.map(
          async (token) =>
            `${PREVIEW_ACCESS_GRANT_COOKIE_PREFIX}${(await sha256(token)).slice(0, 32)}=${token}`,
        ),
      )
    ).join("; ");

  const activated = (grantId: string) =>
    (
      sqlite
        .prepare(
          "SELECT activated_at FROM storefront_preview_access_grants WHERE id = ?",
        )
        .get(grantId) as { activated_at: string | null }
    ).activated_at !== null;

  const activateFlow = (
    input: Partial<Parameters<typeof activatePreviewAccessFlowGrant>[0]> & {
      tokens: readonly string[];
      flowId: string;
    },
  ) =>
    activatePreviewAccessFlowGrant({
      dal,
      previewHost: HOST,
      now: later(3000),
      ...input,
    });

  it("activates the flow's own grant although the browser also holds an older activated one", async () => {
    const older = await framedGrant();
    await activate(older.token);
    const fresh = await framedGrant();
    expect(activated(fresh.grant.id)).toBe(false);
    expect(
      await activateFlow({
        flowId: fresh.flowId,
        tokens: [older.token, fresh.token],
      }),
    ).toEqual({ ok: true });
    expect(activated(fresh.grant.id)).toBe(true);
  });

  it("activates a tab's grant too: the flow's own, whatever its kind", async () => {
    const tab = await framedGrant({ kind: "tab" });
    expect(
      await activateFlow({ flowId: tab.flowId, tokens: [tab.token] }),
    ).toEqual({
      ok: true,
    });
  });

  it("refuses a grant that is not this flow's, and activates nothing", async () => {
    const mine = await framedGrant();
    const other = await framedGrant();
    expect(
      await activateFlow({ flowId: mine.flowId, tokens: [other.token] }),
    ).toEqual({
      ok: false,
      reason: "CHANNEL_NOT_BOUND",
    });
    expect(activated(other.grant.id)).toBe(false);
    expect(activated(mine.grant.id)).toBe(false);
  });

  it("refuses a flow nobody redeemed, a revoked grant and a grant past its window", async () => {
    expect(
      await activateFlow({ flowId: newFlowId(), tokens: ["f".repeat(64)] }),
    ).toEqual({ ok: false, reason: "CHANNEL_NOT_BOUND" });
    const late = await framedGrant();
    expect(
      await activateFlow({
        flowId: late.flowId,
        tokens: [late.token],
        now: later(1000 + 121_000),
      }),
    ).toEqual({ ok: false, reason: "GRANT_NOT_ACTIVATED" });
    const revoked = await framedGrant();
    await revokePreviewAccessForSession({
      dal,
      sessionId: "session-a",
      now: later(2500),
    });
    expect(
      await activateFlow({ flowId: revoked.flowId, tokens: [revoked.token] }),
    ).toEqual({
      ok: false,
      reason: "GRANT_REVOKED",
    });
  });

  it("is a same-origin POST that answers only whether it did", async () => {
    const { flowId, token } = await framedGrant();
    const cookie = await cookieFor(token);
    const request = (
      headers: Record<string, string>,
      body: unknown = { flowId },
    ) =>
      new Request(ACTIVATE, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: `https://${HOST}`,
          "sec-fetch-site": "same-origin",
          cookie,
          ...headers,
        },
        body: JSON.stringify(body),
      });
    const deps = {
      previewParentHostname: PARENT,
      dal,
      forward: vi.fn(async () => new Response("theme")),
      stripCredentials: (r: Request) => r,
      isAppOrigin: (origin: string) => origin === EDITOR,
      now: () => later(3000),
    } satisfies PreviewAccessRequestDeps;

    const cross = await handlePreviewAccessRequest(
      request({ origin: EDITOR, "sec-fetch-site": "cross-site" }),
      deps,
    );
    expect(cross?.status).toBe(403);
    const bad = await handlePreviewAccessRequest(
      request({}, { flowId: "x" }),
      deps,
    );
    expect(bad?.status).toBe(400);
    const get = await handlePreviewAccessRequest(
      new Request(ACTIVATE, { method: "GET", headers: { cookie } }),
      deps,
    );
    expect(get?.status).toBe(405);

    const good = await handlePreviewAccessRequest(request({}), deps);
    expect(good?.status).toBe(200);
    expect(await good?.json()).toEqual({ ok: true });
    expect(deps.forward).not.toHaveBeenCalled();
  });

  it("is asked by the begin page before it leaves", async () => {
    const response = await handlePreviewAccessRequest(
      new Request(
        `https://${HOST}/__morph/preview-auth/begin?flow=${newFlowId()}&return=${encodeURIComponent("/x")}&editorOrigin=${encodeURIComponent(EDITOR)}`,
      ),
      {
        previewParentHostname: PARENT,
        dal,
        forward: vi.fn(),
        stripCredentials: (r: Request) => r,
        isAppOrigin: (origin: string) => origin === EDITOR,
      } as unknown as PreviewAccessRequestDeps,
    );
    expect(await response?.text()).toContain("/__morph/preview-auth/activate");
  });
});
