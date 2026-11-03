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

import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth/minimal";
import { admin } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getPlatformProxy } from "wrangler";

import { ac, administrator, guest, user } from "@/auth/permissions";
import * as schema from "@/db/schema";
import { classifyAuthFailure } from "@/lib/auth/auth-failure";
import { AUTH_COOKIE_PREFIX } from "@/lib/auth/platform-cookies";

/**
 * Who a request is, decided by the session token it carries — through the
 * real Better Auth configuration (`createAuth`), the real auth middlewares and
 * server functions, on a real local D1 (Miniflare) with every migration.
 *
 * The defect this guards (handoff/2026-11-03/pr372-e2e-diag/DIAGNOSIS.md): a
 * browser held account B's `session_token` and account A's `session_data`
 * cookie cache. Better Auth 1.6.23 answers from a valid cache without
 * comparing it with the token (dist/api/routes/session.mjs:85-175), so the
 * request ran as A — an editor save made while B was signed in was written as
 * A, past the ACCOUNT_CHANGED gate. The cache is now off and session renewal
 * is off (src/auth/index.ts); these tests hold both:
 *
 * - (a) B's token with A's cache resolves to B, and an editor save claiming A
 *   is refused with ACCOUNT_CHANGED, the stored file unchanged.
 * - (b) a lower-permission B cannot borrow A's role through A's cache.
 * - (c) a response produced for A and delivered after B signed in sets no
 *   session cookie — also when A's session is due for renewal — so the
 *   browser's next request is still B.
 * - (d) the same for each account operation Morph can reach: A's operation
 *   may complete as A, but its late response does not sign the browser back
 *   in as A. `updateProfile` needed `withoutSessionCookieRewrite` for that:
 *   Better Auth's `updateUser` re-sets the session cookie on success
 *   (dist/api/routes/update-user.mjs:69).
 *
 * Renewal being off means ordinary requests no longer extend a session; the
 * user signs in again when the expiresAt stored in the database is reached.
 *
 * A's `session_data` is minted by Better Auth itself under the configuration
 * this repository shipped before the change (cache on, compact, 300 s), which
 * is exactly the cookie a browser can still hold from before the change. The
 * only thing replaced is the request context (`getRequest`) and the
 * `cloudflare:workers` env, which here carries the real local D1.
 */

type StartServer = typeof import("@tanstack/react-start/server");

const state = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  request: null as Request | null,
}));

vi.mock("cloudflare:workers", () => ({ env: state.env }));
// The real module, so a call can run inside a real Start request event (see
// `serveInEvent`); `state.request` stands in for one where a test has none.
vi.mock("@tanstack/react-start/server", async (importOriginal) => {
  const actual = await importOriginal<StartServer>();
  return {
    ...actual,
    getRequest: () => state.request ?? actual.getRequest(),
  };
});
// Runs the validator, each middleware the function declares, then the
// handler — as storefront-theme-preview-server-access.serverFn.test.ts does —
// starting from the context the client middleware would send.
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
const SECRET = "session-identity-test-secret-0123456789abcdef";
const PASSWORD = "correct horse battery staple";
const TOKEN_COOKIE = `${AUTH_COOKIE_PREFIX}.session_token`;
const DATA_COOKIE = `${AUTH_COOKIE_PREFIX}.session_data`;
// The values src/auth/index.ts sets; renewal is due once a session is older
// than updateAge.
const EXPIRES_IN_S = 60 * 60 * 24 * 7;
const UPDATE_AGE_S = 60 * 60 * 24;

const STORE = "storefront-identity";
const THEME = "theme-identity";
const FILE_ID = "00000000-0000-4000-8000-0000000000a1";
const FILE_PATH = "src/components/Hero.tsx";
const ORIGINAL = "export default function Hero() { return <h1>Hero</h1>; }\n";
const MARKER = "/* saved from a browser signed in as another account */";

let proxy: Awaited<ReturnType<typeof getPlatformProxy>> | null = null;
let dir = "";
let d1: D1Database;

type Auth = ReturnType<(typeof import("@/auth"))["createAuth"]>;
let auth: Auth;
let legacyAuth: ReturnType<typeof legacyConfig>;

const accounts = {
  a: { email: "a-admin@identity.invalid", id: "" },
  b: { email: "b-admin@identity.invalid", id: "" },
  c: { email: "c-user@identity.invalid", id: "" },
};

/**
 * Better Auth as src/auth/index.ts configured it before this change: the
 * cookie cache on (compact, 300 s), renewal on. Same database, secret, cookie
 * prefix and base URL, so its cookies are the ones a browser of that build
 * holds.
 */
function legacyConfig() {
  return betterAuth({
    database: drizzleAdapter(drizzle(d1, { schema }), {
      provider: "sqlite",
      schema,
      usePlural: true,
    }),
    secret: SECRET,
    baseURL: ORIGIN,
    session: {
      expiresIn: EXPIRES_IN_S,
      updateAge: UPDATE_AGE_S,
      cookieCache: { enabled: true, maxAge: 5 * 60, strategy: "compact" },
    },
    advanced: { cookiePrefix: AUTH_COOKIE_PREFIX },
    plugins: [
      admin({
        ac,
        defaultRole: "guest",
        roles: { admin: administrator, user, guest },
      }),
    ],
  });
}

/** A browser's cookie jar for one origin: what Set-Cookie leaves behind. */
class Jar {
  private readonly cookies = new Map<string, string>();

  apply(headers: Headers): void {
    for (const line of headers.getSetCookie()) {
      const [pair = "", ...attributes] = line.split(";");
      const at = pair.indexOf("=");
      const name = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      const expired =
        value === "" ||
        attributes.some((attribute) =>
          /^\s*max-age\s*=\s*0\s*$/i.test(attribute),
        );
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  set(name: string, value: string): void {
    this.cookies.set(name, value);
  }

  get(name: string): string | undefined {
    return this.cookies.get(name);
  }

  header(): string {
    return [...this.cookies]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }
}

/** Names of the cookies a response sets or expires. */
function setCookieNames(headers: Headers): string[] {
  return headers
    .getSetCookie()
    .map((line) => line.slice(0, line.indexOf("=")).trim());
}

async function signIn(jar: Jar, email: string): Promise<void> {
  const { headers } = await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    returnHeaders: true,
  });
  jar.apply(headers);
  expect(jar.get(TOKEN_COOKIE)).toBeTruthy();
}

/** A's `session_data`, as the pre-change configuration issued it. */
async function legacySessionData(tokenCookie: string): Promise<string> {
  const { headers, response } = await legacyAuth.api.getSession({
    headers: new Headers({ cookie: `${TOKEN_COOKIE}=${tokenCookie}` }),
    returnHeaders: true,
  });
  expect(response?.user.id).toBe(accounts.a.id);
  const minted = new Jar();
  minted.apply(headers);
  const data = minted.get(DATA_COOKIE);
  expect(data).toBeTruthy();
  return data!;
}

/** Which test account an id is, so a failure reads "a" vs "b". */
function accountOf(id: string | undefined | null): string | null {
  const found = Object.entries(accounts).find(
    ([, account]) => account.id === id,
  );
  return found ? found[0] : (id ?? null);
}

/** Which account the browser's own `get-session` call reports. */
async function whoAmI(jar: Jar): Promise<string | null> {
  const response = await auth.handler(
    new Request(`${ORIGIN}/api/auth/get-session`, {
      headers: { cookie: jar.header() },
    }),
  );
  const body = (await response.json()) as { user?: { id: string } } | null;
  return accountOf(body?.user?.id);
}

/** A browser holding B's token and A's cache cookie. */
async function mixedJar(other: keyof typeof accounts): Promise<Jar> {
  const jar = new Jar();
  await signIn(jar, accounts.a.email);
  const aToken = jar.get(TOKEN_COOKIE)!;
  const aData = await legacySessionData(aToken);
  await signIn(jar, accounts[other].email);
  expect(jar.get(TOKEN_COOKIE)).not.toBe(aToken);
  // What the late pre-change response left behind in the incident.
  jar.set(DATA_COOKIE, aData);
  return jar;
}

function serverFnRequest(jar: Jar): Request {
  return new Request(`${ORIGIN}/_serverFn/test`, {
    method: "POST",
    headers: { cookie: jar.header() },
  });
}

async function storedFile() {
  return d1
    .prepare("SELECT content, version FROM storefront_theme_files WHERE id = ?")
    .bind(FILE_ID)
    .first<{ content: string; version: number }>();
}

async function sourceGeneration(): Promise<number> {
  const row = await d1
    .prepare(
      "SELECT source_generation AS g FROM storefront_themes WHERE id = ?",
    )
    .bind(THEME)
    .first<{ g: number }>();
  return row!.g;
}

type ServerFnCall = (args: {
  data: unknown;
  context?: object;
}) => Promise<{ success: boolean; message: string; data?: unknown }>;

async function save(jar: Jar, editorWriter: string, content: string) {
  const { saveStorefrontThemeFile } =
    await import("@/server/storefront/storefront-theme-files.serverFn");
  const before = await storedFile();
  state.request = serverFnRequest(jar);
  return (saveStorefrontThemeFile as unknown as ServerFnCall)({
    data: {
      storefrontId: STORE,
      themeId: THEME,
      path: FILE_PATH,
      content,
      expectedFileId: FILE_ID,
      expectedVersion: before!.version,
      expectedSourceGeneration: await sourceGeneration(),
    },
    context: { editorWriter },
  });
}

async function failureOf(run: () => Promise<unknown>) {
  try {
    const result = await run();
    return { code: null, result };
  } catch (error) {
    return { code: classifyAuthFailure(error), result: undefined };
  }
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "session-identity-"));
  writeFileSync(
    join(dir, "wrangler.json"),
    JSON.stringify({
      name: "session-identity-test",
      compatibility_date: "2025-09-02",
      d1_databases: [
        {
          binding: "DATABASE",
          database_name: "identity",
          database_id: "00000000-0000-0000-0000-000000000000",
        },
      ],
      r2_buckets: [{ binding: "R2_BUCKET", bucket_name: "identity" }],
    }),
  );
  proxy = await getPlatformProxy({
    configPath: join(dir, "wrangler.json"),
    persist: { path: join(dir, "state") },
  });
  d1 = (proxy.env as { DATABASE: D1Database }).DATABASE;
  // A save writes a source blob to R2 as well as the row.
  state.env.R2_BUCKET = (proxy.env as { R2_BUCKET: unknown }).R2_BUCKET;
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

  const { createAuth } = await import("@/auth");
  auth = createAuth(state.env as never, `${ORIGIN}/`);
  legacyAuth = legacyConfig();

  for (const [key, account] of Object.entries(accounts)) {
    const created = await auth.api.signUpEmail({
      body: { email: account.email, password: PASSWORD, name: key },
    });
    account.id = created.user.id;
  }
  const setRole = (id: string, role: string) =>
    d1.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, id).run();
  await setRole(accounts.a.id, "admin");
  await setRole(accounts.b.id, "admin");
  await setRole(accounts.c.id, "user");

  await d1
    .prepare(
      `INSERT INTO storefronts (id, sales_channel_id, name, status, created_at, updated_at)
       VALUES (?, 'channel-identity', 'Identity store', 'draft', 'now', 'now')`,
    )
    .bind(STORE)
    .run();
  await d1
    .prepare(
      `INSERT INTO storefront_themes (id, storefront_id, name, status, source_generation, created_at, updated_at)
       VALUES (?, ?, 'Identity theme', 'draft', 1, 'now', 'now')`,
    )
    .bind(THEME, STORE)
    .run();
  await d1
    .prepare(
      `INSERT INTO storefront_theme_files
         (id, storefront_id, theme_id, path, content, mime_type, is_entry, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'text/typescript', 0, 1, 'now', 'now')`,
    )
    .bind(FILE_ID, STORE, THEME, FILE_PATH, ORIGINAL)
    .run();
}, 120_000);

afterAll(async () => {
  state.request = null;
  await proxy?.dispose();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("(a) B's session token with A's cache cookie", () => {
  it("control: a browser signed in only as A saves as A", async () => {
    const jar = new Jar();
    await signIn(jar, accounts.a.email);
    const before = await storedFile();

    const outcome = await failureOf(() =>
      save(jar, accounts.a.id, `${ORIGINAL}// saved by A\n`),
    );

    // The harness can write: a refusal below is the gate, not a broken setup.
    expect(outcome.code).toBeNull();
    expect(outcome.result).toMatchObject({ success: true });
    expect(await storedFile()).toEqual({
      content: `${ORIGINAL}// saved by A\n`,
      version: before!.version + 1,
    });
  });

  it("resolves to B, not to the cached A", async () => {
    const jar = await mixedJar("b");
    expect(await whoAmI(jar)).toBe("b");

    const { headers, response } = await auth.api.getSession({
      headers: new Headers({ cookie: jar.header() }),
      returnHeaders: true,
    });
    expect(accountOf(response?.user.id)).toBe("b");
    // The stale cache cookie is ignored, not expired: Better Auth neither
    // rewrites nor clears it, and the browser drops it at its own Max-Age.
    expect(setCookieNames(headers)).toEqual([]);
  });

  it("refuses an editor save that claims A with ACCOUNT_CHANGED and leaves the file as it was", async () => {
    const jar = await mixedJar("b");
    const before = await storedFile();

    const outcome = await failureOf(() =>
      save(jar, accounts.a.id, `${ORIGINAL}${MARKER}\n`),
    );

    // The stored file first: if the gate is bypassed, this is what says so.
    const after = await storedFile();
    expect(after).toEqual(before);
    expect(after!.content).not.toContain(MARKER);
    expect(outcome.code).toBe("ACCOUNT_CHANGED");
  });

  it("with no claim, runs as B", async () => {
    const jar = await mixedJar("b");
    const { commerceAdminMiddleware } =
      await import("@/server/middleware/auth.middleware");
    state.request = serverFnRequest(jar);
    let seen: string | undefined;
    await (
      commerceAdminMiddleware as unknown as {
        options: {
          server: (args: {
            next: (options: { context: { user: { id: string } } }) => unknown;
            context: object;
          }) => Promise<unknown>;
        };
      }
    ).options.server({
      context: {},
      next: (options) => {
        seen = options.context.user.id;
        return "passed";
      },
    });
    expect(accountOf(seen)).toBe("b");
  });
});

describe("(b) a lower-permission account with an administrator's cache cookie", () => {
  it("control: A alone reads the protected list", async () => {
    const jar = new Jar();
    await signIn(jar, accounts.a.email);
    const { listDashboardUsers } =
      await import("@/server/auth/dashboard-users.serverFn");
    state.request = serverFnRequest(jar);

    const outcome = await failureOf(() =>
      (listDashboardUsers as unknown as ServerFnCall)({ data: {} }),
    );

    expect(outcome.code).toBeNull();
    expect(outcome.result).toMatchObject({ success: true });
  });

  it("gets its own role on a protected read, not A's", async () => {
    const jar = await mixedJar("c");
    const { listDashboardUsers } =
      await import("@/server/auth/dashboard-users.serverFn");
    state.request = serverFnRequest(jar);

    const outcome = await failureOf(() =>
      (listDashboardUsers as unknown as ServerFnCall)({ data: {} }),
    );

    expect(outcome.code).toBe("ACCESS_DENIED");
    expect(outcome.result).toBeUndefined();
    const { response } = await auth.api.getSession({
      headers: new Headers({ cookie: jar.header() }),
      returnHeaders: true,
    });
    expect(response?.user).toMatchObject({ id: accounts.c.id, role: "user" });
  });
});

describe("(c) a response for A that arrives after B signed in", () => {
  /** Makes A's session older than updateAge, so a read would renew it. */
  async function dueForRenewal(tokenCookie: string) {
    const token = decodeURIComponent(tokenCookie).split(".")[0]!;
    const expiresAt = new Date(
      Date.now() + (EXPIRES_IN_S - UPDATE_AGE_S - 60 * 60) * 1000,
    );
    await drizzle(d1, { schema })
      .update(schema.sessions)
      .set({ expiresAt })
      .where(eq(schema.sessions.token, token));
    return { token, expiresAt };
  }

  async function expiresAtOf(token: string) {
    const row = await d1
      .prepare("SELECT expires_at AS e FROM sessions WHERE token = ?")
      .bind(token)
      .first<{ e: number }>();
    return row!.e;
  }

  /**
   * A's request, sent while the browser was A. `processed` says when the
   * server handled it relative to B's sign-in; the browser applies the
   * response after B's sign-in either way.
   */
  async function lateResponsesFor(
    renewal: boolean,
    processed: "before-sign-in" | "after-sign-in",
  ) {
    const jar = new Jar();
    await signIn(jar, accounts.a.email);
    const aToken = jar.get(TOKEN_COOKIE)!;
    const due = renewal ? await dueForRenewal(aToken) : null;
    const sentAsA = jar.header();

    const serve = async () => {
      // The browser's own get-session call (useSession, "Check again").
      const http = await auth.handler(
        new Request(`${ORIGIN}/api/auth/get-session`, {
          headers: { cookie: sentAsA },
        }),
      );
      expect(((await http.json()) as { user: { id: string } }).user.id).toBe(
        accounts.a.id,
      );
      // What every auth middleware calls; its Set-Cookie is what
      // tanstackStartCookies forwards onto the server function's response.
      const api = await auth.api.getSession({
        headers: new Headers({ cookie: sentAsA }),
        returnHeaders: true,
      });
      expect(api.response?.user.id).toBe(accounts.a.id);
      return [http.headers, api.headers];
    };

    let held: Headers[] = [];
    if (processed === "before-sign-in") held = await serve();
    await signIn(jar, accounts.b.email);
    if (processed === "after-sign-in") held = await serve();
    for (const headers of held) jar.apply(headers);

    return { jar, held, due };
  }

  for (const renewal of [false, true]) {
    for (const processed of ["before-sign-in", "after-sign-in"] as const) {
      it(`${renewal ? "session due for renewal" : "fresh session"}, processed ${processed}: sets no session cookie and the browser stays B`, async () => {
        const { jar, held, due } = await lateResponsesFor(renewal, processed);

        // Who the browser is next, first: that is the property.
        expect(await whoAmI(jar)).toBe("b");
        for (const headers of held) {
          expect(setCookieNames(headers)).not.toContain(TOKEN_COOKIE);
          expect(setCookieNames(headers)).not.toContain(DATA_COOKIE);
        }
        if (due) {
          // Not renewed: the row keeps the expiry it was given.
          expect(await expiresAtOf(due.token)).toBe(due.expiresAt.getTime());
        }
      });
    }
  }
});

/**
 * Runs `run` inside a real TanStack Start request event, as a server function
 * call does in the Worker, and returns the response the browser would get.
 * `tanstackStartCookies` puts every Set-Cookie of a Better Auth call made
 * during the event onto that response — which is what this observes.
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

describe("(d) an account operation for A whose response arrives after B signed in", () => {
  it("control: the event harness sees Set-Cookie a Better Auth call makes", async () => {
    const { headers } = await serveInEvent("", () =>
      auth.api.signInEmail({
        body: { email: accounts.a.email, password: PASSWORD },
      }),
    );
    expect(setCookieNames(headers)).toContain(TOKEN_COOKIE);
  });

  /**
   * A's operation, sent while the browser was A, served `processed` relative
   * to B's sign-in, its response applied to the jar after B's sign-in.
   */
  async function lateOperation(
    processed: "before-sign-in" | "after-sign-in",
    operation: (
      sentAsA: string,
    ) => Promise<{ headers: Headers; result: unknown }>,
  ) {
    const jar = new Jar();
    await signIn(jar, accounts.a.email);
    const sentAsA = jar.header();
    let served: { headers: Headers; result: unknown } | null = null;
    if (processed === "before-sign-in") served = await operation(sentAsA);
    await signIn(jar, accounts.b.email);
    if (processed === "after-sign-in") served = await operation(sentAsA);
    jar.apply(served!.headers);
    return { jar, ...served! };
  }

  const nameOf = async (id: string) =>
    (await d1
      .prepare("SELECT name FROM users WHERE id = ?")
      .bind(id)
      .first<{ name: string }>())!.name;

  for (const processed of ["before-sign-in", "after-sign-in"] as const) {
    it(`updateProfile, processed ${processed}: A's update lands, the browser stays B`, async () => {
      const { updateProfile } =
        await import("@/server/auth/update-profile.serverFn");
      const name =
        processed === "before-sign-in" ? "A renamed early" : "A renamed late";
      const form = new FormData();
      form.set("name", name);
      form.set("language", "en");

      const { jar, headers, result } = await lateOperation(
        processed,
        (sentAsA) =>
          serveInEvent(sentAsA, () =>
            (updateProfile as unknown as ServerFnCall)({ data: form }),
          ),
      );

      // Who the browser is next: the property.
      expect(await whoAmI(jar)).toBe("b");
      expect(setCookieNames(headers)).not.toContain(TOKEN_COOKIE);
      // A's own authorised update still happened, as A.
      expect(result).toMatchObject({ success: true });
      expect(await nameOf(accounts.a.id)).toBe(name);
    });
  }

  it("listSessions: the browser stays B", async () => {
    const { listSessions } =
      await import("@/server/auth/list-sessions.serverFn");
    const { jar, result } = await lateOperation("before-sign-in", (sentAsA) =>
      serveInEvent(sentAsA, () =>
        (listSessions as unknown as ServerFnCall)({ data: undefined }),
      ),
    );
    expect(await whoAmI(jar)).toBe("b");
    expect(result).toMatchObject({ sessions: expect.any(Array) });
  });

  it("revokeSession (another of A's sessions): the browser stays B", async () => {
    const other = new Jar();
    await signIn(other, accounts.a.email);
    const otherToken = decodeURIComponent(other.get(TOKEN_COOKIE)!).split(
      ".",
    )[0]!;
    const otherId = (await d1
      .prepare("SELECT id FROM sessions WHERE token = ?")
      .bind(otherToken)
      .first<{ id: string }>())!.id;
    const { revokeSession } =
      await import("@/server/auth/revoke-session.serverFn");

    const { jar, result } = await lateOperation("before-sign-in", (sentAsA) =>
      serveInEvent(sentAsA, () =>
        (revokeSession as unknown as ServerFnCall)({ data: { id: otherId } }),
      ),
    );

    expect(await whoAmI(jar)).toBe("b");
    expect(result).toMatchObject({ success: true });
    expect(await whoAmI(other)).toBeNull();
  });

  it("updateDashboardUser (A as admin): the browser stays B", async () => {
    const { updateDashboardUser } =
      await import("@/server/auth/dashboard-users.serverFn");
    const { jar, result } = await lateOperation("before-sign-in", (sentAsA) =>
      serveInEvent(sentAsA, () =>
        (updateDashboardUser as unknown as ServerFnCall)({
          data: { id: accounts.c.id, firstName: "C", lastName: "Renamed" },
        }),
      ),
    );
    expect(await whoAmI(jar)).toBe("b");
    expect(result).toMatchObject({ success: true });
    expect(await nameOf(accounts.c.id)).toBe("C Renamed");
  });

  it("revoke-other-sessions (browser call): the browser stays B", async () => {
    const { jar } = await lateOperation("before-sign-in", async (sentAsA) => {
      const response = await auth.handler(
        new Request(`${ORIGIN}/api/auth/revoke-other-sessions`, {
          method: "POST",
          headers: {
            cookie: sentAsA,
            origin: ORIGIN,
            "content-type": "application/json",
          },
          body: "{}",
        }),
      );
      expect(response.status).toBe(200);
      return { headers: response.headers, result: null };
    });
    expect(await whoAmI(jar)).toBe("b");
  });

  it("sign-out (browser call): the browser is signed out, never A", async () => {
    const { jar } = await lateOperation("before-sign-in", async (sentAsA) => {
      const response = await auth.handler(
        new Request(`${ORIGIN}/api/auth/sign-out`, {
          method: "POST",
          headers: {
            cookie: sentAsA,
            origin: ORIGIN,
            "content-type": "application/json",
          },
          body: "{}",
        }),
      );
      expect(response.status).toBe(200);
      return { headers: response.headers, result: null };
    });
    // A's sign-out clears the session cookie it answers with, so the late
    // response signs this browser out. It does not make it A.
    expect(await whoAmI(jar)).toBeNull();
  });
});
