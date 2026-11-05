// @vitest-environment node
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { getPlatformProxy } from "wrangler";

import * as schema from "@/db/schema";
import { AUTH_COOKIE_PREFIX } from "@/lib/auth/platform-cookies";
import { storefrontPreviewAccessDal } from "@/lib/storefront/dal/storefront-preview-access.dal";
import { createPreviewAccessSecret } from "@/lib/storefront/service/preview-access/preview-access";
import {
  handlePreviewAccessRequest,
  previewAccessHostname,
  type PreviewAccessDecision,
} from "@/lib/storefront/service/preview-access/preview-access-request";
import { previewRequestFor } from "@/lib/storefront/service/preview-proxy-credentials";
import { deriveThemePreviewSessionId } from "@/lib/storefront/service/theme-preview-session-id";

/**
 * Live Preview access (#214 P2) under the auth configuration #379 shipped —
 * cookie cache off, session renewal off — through the real Better Auth
 * (`createAuth`), the real `commerceAdminMiddleware`, the real preview-access
 * DAL and service, on a real local D1 (Miniflare) with every migration.
 *
 * What this layer proves: a grant is issued through the real server function
 * and a real `getSession`; the next `pv-` request is decided from the session
 * row Better Auth itself wrote; that row's expiresAt is never moved by
 * issuance, redeem or a served request. And (#214 P2d) that sign-out and
 * revoke-other-sessions, through Better Auth's own routes and the hooks in
 * src/auth/index.ts, revoke exactly the ended sessions' grants in D1 and push
 * their close, so the next request is refused as GRANT_REVOKED; a profile
 * update that keeps the role revokes nothing.
 *
 * What it does not: `src/server.ts` routing and the forward into a container
 * (the local container E2E covers those), or that open sockets actually close:
 * the preview's Durable Object is a stand-in (`push`) that records the close
 * it was asked for.
 *
 * Time: issuance runs on the real clock. The service's `now` is injected only
 * as values derived from the stored session row (so no case races the real
 * clock); the exact 10-minute reuse boundary stays with the controlled-time
 * unit tests in preview-access.test.ts.
 */

const state = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  request: null as Request | null,
}));

vi.mock("cloudflare:workers", () => ({ env: state.env }));
// The preview's Durable Object, the one stand-in for the revocation hooks
// (as preview-access-revocation.integration.test.ts): records each close.
const push = vi.hoisted(() => ({
  calls: [] as Array<{ previewId: string; grantIds: string[] }>,
  fail: false,
}));
vi.mock("@cloudflare/sandbox", () => ({
  getSandbox: (_ns: unknown, previewId: string) => ({
    closePreviewGrants: async (grantIds: string[]) => {
      if (push.fail) throw new Error("push down");
      push.calls.push({ previewId, grantIds });
      return grantIds.length;
    },
  }),
}));
vi.mock("@/lib/email", () => ({
  sendAuthVerificationEmail: async () => {},
  sendPasswordResetEmail: async () => {},
}));
vi.mock("@tanstack/react-start/server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-start/server")>();
  return {
    ...actual,
    getRequest: () => state.request ?? actual.getRequest(),
  };
});
// Runs the validator, each middleware the function declares, then the
// handler — as session-identity.integration.test.ts does.
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  type Validator = (data: unknown) => unknown;
  type Middleware = {
    options: {
      server: (args: {
        next: (options?: { context?: object }) => Promise<unknown>;
        context: object;
      }) => Promise<unknown>;
    };
  };
  type Handler = (args: { data: unknown; context: object }) => unknown;
  function builder(
    validator: Validator = (data) => data,
    middlewares: readonly Middleware[] = [],
  ) {
    return {
      validator: (next: Validator) => builder(next, middlewares),
      middleware: (next: readonly Middleware[]) =>
        builder(validator, [...middlewares, ...next]),
      handler:
        (handler: Handler) =>
        async ({ data, context }: { data: unknown; context?: object }) => {
          const validated = validator(data);
          const run = async (
            index: number,
            current: object,
          ): Promise<unknown> =>
            index === middlewares.length
              ? handler({ data: validated, context: current })
              : middlewares[index]!.options.server({
                  context: current,
                  next: (options) =>
                    run(index + 1, { ...current, ...options?.context }),
                });
          return run(0, context ?? {});
        },
    };
  }
  return { ...actual, createServerFn: () => builder() };
});

const ORIGIN = "http://localhost:3000";
const SECRET = "preview-access-session-test-secret-0123456789";
const PASSWORD = "correct horse battery staple";
const TOKEN_COOKIE = `${AUTH_COOKIE_PREFIX}.session_token`;
const PARENT = "preview.example.test";
const STORE = "00000000-0000-4000-8000-00000000b001";
const THEME = "00000000-0000-4000-8000-00000000b002";
const RETURN = `/?editorOrigin=${encodeURIComponent(ORIGIN)}&previewSession=s1`;
const MINUTE = 60_000;
// src/auth/index.ts: sessions last 7 days; a renewing read would have moved
// one older than a day.
const EXPIRES_IN_MS = 7 * 24 * 60 * MINUTE;
const UPDATE_AGE_MS = 24 * 60 * MINUTE;

type Account = {
  email: string;
  id: string;
  previewId: string;
  pvOrigin: string;
};
const account = (email: string): Account => ({
  email,
  id: "",
  previewId: "",
  pvOrigin: "",
});
const ADMIN = account("preview-admin@preview-access.invalid");
// A second admin whose only sessions are the ones a case opens, so a call
// that ends "every other session" ends exactly those.
const OTHER_ADMIN = account("preview-admin-2@preview-access.invalid");

let proxy: Awaited<ReturnType<typeof getPlatformProxy>> | null = null;
let dir = "";
let d1: D1Database;
type Auth = ReturnType<(typeof import("@/auth"))["createAuth"]>;
let auth: Auth;

type ServerFnCall = (args: { data: unknown; context?: object }) => Promise<{
  success: boolean;
  message: string;
  data?: { code: string; expiresAt: string };
  error?: string;
}>;

/** The author's browser: the app origin's cookies and the pv- host's. */
class Browser {
  constructor(readonly account: Account) {}

  readonly app = new Map<string, string>();
  readonly pv = new Map<string, string>();

  static apply(jar: Map<string, string>, headers: Headers): void {
    for (const line of headers.getSetCookie()) {
      const [pair = "", ...attributes] = line.split(";");
      const at = pair.indexOf("=");
      const name = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      const expired =
        value === "" ||
        attributes.some((a) => /^\s*max-age\s*=\s*0\s*$/i.test(a));
      if (expired) jar.delete(name);
      else jar.set(name, value);
    }
  }

  static header(jar: Map<string, string>): string {
    return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  /** The session token as stored in `sessions.token`. */
  sessionToken(): string {
    return decodeURIComponent(this.app.get(TOKEN_COOKIE)!).split(".")[0]!;
  }
}

async function signIn(who: Account = ADMIN): Promise<Browser> {
  const browser = new Browser(who);
  const { headers } = await auth.api.signInEmail({
    body: { email: who.email, password: PASSWORD },
    returnHeaders: true,
  });
  Browser.apply(browser.app, headers);
  expect(browser.app.get(TOKEN_COOKIE)).toBeTruthy();
  return browser;
}

async function sessionRow(token: string) {
  return d1
    .prepare("SELECT id, expires_at AS expiresAt FROM sessions WHERE token = ?")
    .bind(token)
    .first<{ id: string; expiresAt: number }>();
}

async function setSessionExpiry(token: string, expiresAtMs: number) {
  await drizzle(d1, { schema })
    .update(schema.sessions)
    .set({ expiresAt: new Date(expiresAtMs) })
    .where(eq(schema.sessions.token, token));
}

async function grantRows(sessionId: string) {
  const { results } = await d1
    .prepare(
      "SELECT id, expires_at AS expiresAt FROM storefront_preview_access_grants WHERE session_id = ? AND deleted_at IS NULL",
    )
    .bind(sessionId)
    .all<{ id: string; expiresAt: string }>();
  return results;
}

/** Every grant of a session, revoked or not, as stored. */
async function grantState(sessionId: string) {
  const { results } = await d1
    .prepare(
      "SELECT id, preview_id AS previewId, revoked_at AS revokedAt, deleted_at AS deletedAt, expires_at AS expiresAt FROM storefront_preview_access_grants WHERE session_id = ?",
    )
    .bind(sessionId)
    .all<{
      id: string;
      previewId: string;
      revokedAt: string | null;
      deletedAt: string | null;
      expiresAt: string;
    }>();
  return results;
}

/** `revokedAt` set by the real clock, inside [t0, t1]. */
function expectRevokedWithin(revokedAt: string | null, t0: number, t1: number) {
  expect(revokedAt).not.toBeNull();
  const at = Date.parse(revokedAt!);
  expect(at).toBeGreaterThanOrEqual(t0);
  expect(at).toBeLessThanOrEqual(t1);
}

/**
 * Runs `run` inside a real TanStack Start request event, as a server function
 * call does in the Worker (copied from session-identity.integration.test.ts):
 * `updateProfile` reads the event's response headers.
 */
async function serveInEvent(cookie: string, run: () => Promise<unknown>) {
  const { requestHandler } = await import("@tanstack/react-start/server");
  state.request = null;
  let result: unknown;
  const response = await requestHandler(async () => {
    result = await run();
    return new Response("served");
  })(
    new Request(`${ORIGIN}/_serverFn/test`, {
      method: "POST",
      headers: { cookie, origin: ORIGIN },
    }),
    {} as never,
  );
  return { headers: response.headers, result };
}

const authPost = (path: string, browser: Browser) =>
  auth.handler(
    new Request(`${ORIGIN}/api/auth/${path}`, {
      method: "POST",
      headers: {
        cookie: Browser.header(browser.app),
        origin: ORIGIN,
        "content-type": "application/json",
      },
      body: "{}",
    }),
  );

/** One request on the pv- host, decided by the real DAL and service. */
async function pv(
  request: Request,
  now?: Date,
): Promise<{
  response: Response;
  decision: PreviewAccessDecision | null;
  forwarded: Request[];
}> {
  const forwarded: Request[] = [];
  let decision: PreviewAccessDecision | null = null;
  const response = await handlePreviewAccessRequest(
    request,
    {
      previewParentHostname: PARENT,
      dal: storefrontPreviewAccessDal,
      stripCredentials: previewRequestFor,
      isAppOrigin: (origin) => origin === ORIGIN,
      forward: async (_previewId, forwardedRequest) => {
        forwarded.push(forwardedRequest);
        return new Response("<p>DRAFT</p>");
      },
      ...(now ? { now: () => now } : {}),
    },
    (observed) => {
      decision = observed;
    },
  );
  expect(response).not.toBeNull();
  return { response: response!, decision, forwarded };
}

/** begin → issueThemePreviewAccess (as the editor) → redeem, on real time. */
async function flow(browser: Browser) {
  const flowId = createPreviewAccessSecret().slice(0, 32);
  const beginUrl = new URL(
    "/__morph/preview-auth/begin",
    browser.account.pvOrigin,
  );
  beginUrl.searchParams.set("flow", flowId);
  beginUrl.searchParams.set("return", RETURN);
  beginUrl.searchParams.set("editorOrigin", ORIGIN);
  const begun = await pv(
    new Request(beginUrl, { headers: { cookie: Browser.header(browser.pv) } }),
  );
  expect(begun.response.status).toBe(200);
  const binderHash = /"binderHash":"([0-9a-f]{64})"/.exec(
    await begun.response.text(),
  )![1]!;
  Browser.apply(browser.pv, begun.response.headers);

  const { issueThemePreviewAccess } =
    await import("@/server/storefront/storefront-theme-preview-access.serverFn");
  state.request = new Request(`${ORIGIN}/_serverFn/test`, {
    method: "POST",
    headers: { cookie: Browser.header(browser.app) },
  });
  const issued = await (issueThemePreviewAccess as unknown as ServerFnCall)({
    data: { storefrontId: STORE, themeId: THEME, flowId, binderHash },
  });
  state.request = null;
  expect(issued.success).toBe(true);

  const redeemed = await pv(
    new Request(
      new URL("/__morph/preview-auth/redeem", browser.account.pvOrigin),
      {
        method: "POST",
        headers: {
          origin: browser.account.pvOrigin,
          cookie: Browser.header(browser.pv),
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          flow: flowId,
          return: RETURN,
          editorOrigin: ORIGIN,
          code: issued.data!.code,
        }).toString(),
      },
    ),
  );
  expect(redeemed.response.status).toBe(200);
  Browser.apply(browser.pv, redeemed.response.headers);
  return { flowId, redeemed: redeemed.response };
}

const page = (browser: Browser, now?: Date) =>
  pv(
    new Request(new URL("/", browser.account.pvOrigin), {
      headers: { cookie: Browser.header(browser.pv) },
    }),
    now,
  );

const setsGrantCookie = (response: Response, flowId: string) =>
  response.headers
    .getSetCookie()
    .some(
      (c) =>
        c.startsWith(`__Host-morph-pv-${flowId}=`) && !/max-age=0/i.test(c),
    );

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "preview-access-session-"));
  writeFileSync(
    join(dir, "wrangler.json"),
    JSON.stringify({
      name: "preview-access-session-test",
      compatibility_date: "2025-09-02",
      d1_databases: [
        {
          binding: "DATABASE",
          database_name: "preview-access",
          database_id: "00000000-0000-0000-0000-000000000000",
        },
      ],
    }),
  );
  proxy = await getPlatformProxy({
    configPath: join(dir, "wrangler.json"),
    persist: { path: join(dir, "state") },
  });
  d1 = (proxy.env as { DATABASE: D1Database }).DATABASE;
  const migrations = join(process.cwd(), "drizzle");
  for (const file of readdirSync(migrations)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    for (const statement of readFileSync(join(migrations, file), "utf8").split(
      "--> statement-breakpoint",
    )) {
      if (statement.trim()) await d1.prepare(statement.trim()).run();
    }
  }
  state.env.DATABASE = d1;
  state.env.BETTER_AUTH_SECRET = SECRET;
  state.env.THEME_PREVIEW_HOSTNAME = PARENT;
  state.env.PreviewSandbox = {};

  const { createAuth } = await import("@/auth");
  auth = createAuth(state.env as never, `${ORIGIN}/`);
  for (const who of [ADMIN, OTHER_ADMIN]) {
    const created = await auth.api.signUpEmail({
      body: { email: who.email, password: PASSWORD, name: "admin" },
    });
    who.id = created.user.id;
    await d1
      .prepare("UPDATE users SET role = 'admin' WHERE id = ?")
      .bind(who.id)
      .run();
  }

  await d1
    .prepare(
      `INSERT INTO storefronts (id, sales_channel_id, name, status, created_at, updated_at)
       VALUES (?, 'channel-preview-access', 'Preview access store', 'draft', 'now', 'now')`,
    )
    .bind(STORE)
    .run();
  await d1
    .prepare(
      `INSERT INTO storefront_themes (id, storefront_id, name, status, source_generation, created_at, updated_at)
       VALUES (?, ?, 'Preview access theme', 'draft', 1, 'now', 'now')`,
    )
    .bind(THEME, STORE)
    .run();

  for (const who of [ADMIN, OTHER_ADMIN]) {
    who.previewId = await deriveThemePreviewSessionId({
      storefrontId: STORE,
      themeId: THEME,
      userId: who.id,
    });
    who.pvOrigin = `https://${previewAccessHostname(who.previewId, PARENT)}`;
  }
}, 120_000);

afterAll(async () => {
  state.request = null;
  await proxy?.dispose();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("Live Preview access on the auth configuration without cache or renewal", () => {
  beforeEach(() => {
    push.calls = [];
    push.fail = false;
  });

  it("issues through the real server function and serves the next pv- request, without moving the session's expiry", async () => {
    const browser = await signIn();
    const token = browser.sessionToken();
    // Old enough that a renewing read would have extended it.
    const dueAt = Date.now() + EXPIRES_IN_MS - UPDATE_AGE_MS - 60 * MINUTE;
    await setSessionExpiry(token, dueAt);
    const before = (await sessionRow(token))!.expiresAt;
    expect(before).toBe(dueAt);

    const { flowId } = await flow(browser);
    expect((await sessionRow(token))!.expiresAt).toBe(before);
    expect(browser.pv.get(`__Host-morph-pv-${flowId}`)).toMatch(
      /^[0-9a-f]{64}$/,
    );

    const served = await page(browser);
    expect(served.response.status).toBe(200);
    expect(await served.response.text()).toContain("DRAFT");
    expect(served.decision?.kind).toBe("served");
    expect(served.forwarded).toHaveLength(1);
    expect(served.forwarded[0]!.headers.get("cookie")).toBeNull();
    expect((await sessionRow(token))!.expiresAt).toBe(before);

    // The grant is capped by the session it was issued for.
    const [grant] = await grantRows((await sessionRow(token))!.id);
    expect(Date.parse(grant!.expiresAt)).toBeLessThanOrEqual(before);
  });

  it("sign-out revokes the session's grant through the real hook and pushes its close; the next request is refused as GRANT_REVOKED", async () => {
    const browser = await signIn();
    const token = browser.sessionToken();
    const sessionId = (await sessionRow(token))!.id;
    await flow(browser);
    expect((await page(browser)).response.status).toBe(200);
    const [issued] = await grantState(sessionId);
    expect(issued!.revokedAt).toBeNull();
    expect(issued!.previewId).toBe(ADMIN.previewId);

    const t0 = Date.now();
    const signedOut = await authPost("sign-out", browser);
    const t1 = Date.now();
    expect(signedOut.status).toBe(200);
    expect(await sessionRow(token)).toBeNull();

    const grants = await grantState(sessionId);
    expect(grants).toHaveLength(1);
    expect(grants[0]!.id).toBe(issued!.id);
    expect(grants[0]!.deletedAt).toBeNull();
    expectRevokedWithin(grants[0]!.revokedAt, t0, t1);
    expect(push.calls).toEqual([
      { previewId: ADMIN.previewId, grantIds: [issued!.id] },
    ]);

    const next = await page(browser);
    expect(next.response.status).toBe(403);
    expect(next.decision).toEqual({ kind: "refused", reason: "GRANT_REVOKED" });
    expect(next.forwarded).toHaveLength(0);
    expect(await next.response.text()).not.toContain("DRAFT");
  });

  it("revoke-other-sessions revokes only the other session's grant: that one is refused as GRANT_REVOKED, the caller's is still served", async () => {
    const a = await signIn(OTHER_ADMIN);
    const b = await signIn(OTHER_ADMIN);
    const sessionA = (await sessionRow(a.sessionToken()))!.id;
    const sessionB = (await sessionRow(b.sessionToken()))!.id;
    expect(sessionA).not.toBe(sessionB);
    await flow(a);
    await flow(b);
    expect((await page(a)).response.status).toBe(200);
    expect((await page(b)).response.status).toBe(200);
    const [grantA] = await grantState(sessionA);
    const [grantB] = await grantState(sessionB);
    expect(grantA!.id).not.toBe(grantB!.id);

    const t0 = Date.now();
    const revoked = await authPost("revoke-other-sessions", a);
    const t1 = Date.now();
    expect(revoked.status).toBe(200);
    expect(await sessionRow(b.sessionToken())).toBeNull();
    expect(await sessionRow(a.sessionToken())).not.toBeNull();

    expectRevokedWithin((await grantState(sessionB))[0]!.revokedAt, t0, t1);
    expect((await grantState(sessionA))[0]!.revokedAt).toBeNull();
    expect(push.calls).toEqual([
      { previewId: OTHER_ADMIN.previewId, grantIds: [grantB!.id] },
    ]);

    const nextB = await page(b);
    expect(nextB.response.status).toBe(403);
    expect(nextB.decision).toEqual({
      kind: "refused",
      reason: "GRANT_REVOKED",
    });
    expect(nextB.forwarded).toHaveLength(0);
    expect(await nextB.response.text()).not.toContain("DRAFT");

    const nextA = await page(a);
    expect(nextA.response.status).toBe(200);
    expect(nextA.decision?.kind).toBe("served");
    expect(nextA.forwarded).toHaveLength(1);
  });

  it("an updateProfile name change that keeps the role revokes nothing and the grant is still served", async () => {
    const browser = await signIn();
    const sessionId = (await sessionRow(browser.sessionToken()))!.id;
    await flow(browser);
    expect((await page(browser)).response.status).toBe(200);

    const { updateProfile } =
      await import("@/server/auth/update-profile.serverFn");
    const form = new FormData();
    form.set("name", "Renamed by profile");
    form.set("language", "en");
    const { result } = await serveInEvent(Browser.header(browser.app), () =>
      (updateProfile as unknown as ServerFnCall)({ data: form }),
    );
    expect(result).toMatchObject({ success: true });
    const user = await d1
      .prepare("SELECT name, role, banned FROM users WHERE id = ?")
      .bind(ADMIN.id)
      .first<{ name: string; role: string; banned: number | null }>();
    expect(user).toMatchObject({ name: "Renamed by profile", role: "admin" });
    expect(Boolean(user!.banned)).toBe(false);

    const grants = await grantState(sessionId);
    expect(grants).toHaveLength(1);
    expect(grants[0]!.revokedAt).toBeNull();
    expect(push.calls).toEqual([]);

    const next = await page(browser);
    expect(next.response.status).toBe(200);
    expect(next.decision?.kind).toBe("served");
    expect(next.forwarded).toHaveLength(1);
  });

  it("does not reuse a grant with clearly under 10 minutes left: a new, different grant, still capped by the session", async () => {
    const browser = await signIn();
    const token = browser.sessionToken();
    const sessionExpiry = Date.now() + 5 * MINUTE;
    await setSessionExpiry(token, sessionExpiry);
    const sessionId = (await sessionRow(token))!.id;

    const first = await flow(browser);
    // Used once, so activated: the only reason left not to reuse it is time.
    expect((await page(browser)).response.status).toBe(200);
    const [firstGrant] = await grantRows(sessionId);
    expect(Date.parse(firstGrant!.expiresAt)).toBe(sessionExpiry);

    const second = await flow(browser);
    expect(setsGrantCookie(second.redeemed, second.flowId)).toBe(true);
    const grants = await grantRows(sessionId);
    expect(grants).toHaveLength(2);
    const secondGrant = grants.find((g) => g.id !== firstGrant!.id)!;
    expect(secondGrant).toBeDefined();
    expect(Date.parse(secondGrant.expiresAt)).toBeLessThanOrEqual(
      sessionExpiry,
    );
    expect(browser.pv.get(`__Host-morph-pv-${second.flowId}`)).not.toBe(
      browser.pv.get(`__Host-morph-pv-${first.flowId}`),
    );
    expect((await sessionRow(token))!.expiresAt).toBe(sessionExpiry);
  });

  it("control: with well over 10 minutes left the held grant is reused, and no grant is added", async () => {
    const browser = await signIn();
    const token = browser.sessionToken();
    const sessionExpiry = Date.now() + 60 * MINUTE;
    await setSessionExpiry(token, sessionExpiry);
    const sessionId = (await sessionRow(token))!.id;

    await flow(browser);
    expect((await page(browser)).response.status).toBe(200);
    const second = await flow(browser);

    expect(setsGrantCookie(second.redeemed, second.flowId)).toBe(false);
    expect(await grantRows(sessionId)).toHaveLength(1);
    expect((await sessionRow(token))!.expiresAt).toBe(sessionExpiry);
  });

  it("refuses at the session's fixed end, as the grant capped to it (GRANT_EXPIRED), without extending the session", async () => {
    const browser = await signIn();
    const token = browser.sessionToken();
    const sessionExpiry = Date.now() + 60 * MINUTE;
    await setSessionExpiry(token, sessionExpiry);

    await flow(browser);
    expect((await page(browser)).response.status).toBe(200);

    // Times taken from the stored row, not the real clock.
    const stored = (await sessionRow(token))!.expiresAt;
    expect(stored).toBe(sessionExpiry);
    const justBefore = await page(browser, new Date(stored - MINUTE));
    expect(justBefore.response.status).toBe(200);

    const atEnd = await page(browser, new Date(stored));
    expect(atEnd.response.status).toBe(403);
    expect(atEnd.decision).toEqual({
      kind: "refused",
      reason: "GRANT_EXPIRED",
    });
    expect(atEnd.forwarded).toHaveLength(0);
    expect((await sessionRow(token))!.expiresAt).toBe(stored);
  });
});
