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

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getPlatformProxy } from "wrangler";

/**
 * A storefront and the CMS on one site (`stg.showtrue.com.tw` and
 * `admin-stg.showtrue.com.tw`): SameSite cookies protect nothing between
 * them, so these hold the other defences — through the real route handlers,
 * the real Better Auth configuration (`createAuth`, production mode, HTTPS
 * `PUBLIC_URL`), on a real local D1 (Miniflare) with every migration.
 *
 * - `/api/admin/*` and the Theme binary upload refuse a cookie-authenticated
 *   write from any origin but the CMS's own, before anything is read or
 *   written; a Basic secret-key request is exempt; a non-JSON body is 415.
 * - the session cookie is `__Host-`, with no Domain, and a duplicate of it
 *   fails safe.
 * - a staff account cannot sign in on a storefront host; a customer can.
 * - a `/api/store` write that carries the session cookie must be same-origin.
 *
 * The only things replaced are the `cloudflare:workers` env (carrying the real
 * local D1) and the mailer.
 */

const state = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("cloudflare:workers", () => ({ env: state.env }));
vi.mock("@/lib/email", () => ({
  sendAuthVerificationEmail: async () => {},
  sendPasswordResetEmail: async () => {},
}));

const ADMIN_ORIGIN = "https://admin-stg.showtrue.com.tw";
const STOREFRONT_HOST = "stg.showtrue.com.tw";
const STOREFRONT_ORIGIN = `https://${STOREFRONT_HOST}`;
const SECRET = "same-site-hardening-test-secret-0123456789abcdef";
const PASSWORD = "correct horse battery staple";
const SESSION_COOKIE = "__Host-better-auth.session_token";

const accounts = {
  admin: { email: "admin@same-site.invalid", id: "" },
  editor: { email: "editor@same-site.invalid", id: "" },
  customer: { email: "customer@same-site.invalid", id: "" },
};

let proxy: Awaited<ReturnType<typeof getPlatformProxy>> | null = null;
let dir = "";
let d1: D1Database;

type RouteHandler = (args: { request: Request }) => Promise<Response>;
type ServerRoute = {
  options: { server: { handlers: Record<string, RouteHandler> } };
};
let adminRoute: ServerRoute;
let themeBinaryRoute: ServerRoute;
let storeRoute: ServerRoute;
let adminSessionCookie = "";

async function count(table: string): Promise<number> {
  const row = await d1
    .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
    .first<{ n: number }>();
  return row!.n;
}

/** The `name=value` of the session cookie a Set-Cookie list carries. */
function sessionCookieOf(headers: Headers): string {
  const line = headers
    .getSetCookie()
    .find((value) => value.startsWith(`${SESSION_COOKIE}=`));
  expect(line, "no __Host- session cookie was set").toBeTruthy();
  return line!.split(";")[0]!;
}

async function signInOnCms(email: string): Promise<Headers> {
  const { createAuth } = await import("@/auth");
  const auth = createAuth(state.env as never, `${ADMIN_ORIGIN}/`);
  const { headers } = await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    returnHeaders: true,
  });
  return headers;
}

function adminPost(
  path: string,
  headers: Record<string, string>,
  body = JSON.stringify({ title: "From the test", type: "secret" }),
): Request {
  return new Request(`${ADMIN_ORIGIN}/api/admin/${path}`, {
    method: "POST",
    headers: {
      cookie: adminSessionCookie,
      "content-type": "application/json",
      ...headers,
    },
    body,
  });
}

const sameSiteStorefront = {
  "sec-fetch-site": "same-site",
  origin: STOREFRONT_ORIGIN,
};
const sameOriginCms = { "sec-fetch-site": "same-origin", origin: ADMIN_ORIGIN };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "same-site-hardening-"));
  writeFileSync(
    join(dir, "wrangler.json"),
    JSON.stringify({
      name: "same-site-hardening-test",
      compatibility_date: "2025-09-02",
      d1_databases: [
        {
          binding: "DATABASE",
          database_name: "same-site",
          database_id: "00000000-0000-0000-0000-000000000000",
        },
      ],
      r2_buckets: [{ binding: "R2_BUCKET", bucket_name: "same-site" }],
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
  state.env.R2_BUCKET = (proxy.env as { R2_BUCKET: unknown }).R2_BUCKET;
  state.env.BETTER_AUTH_SECRET = SECRET;
  // A deployed CMS: its origin is configuration, not the request's Host.
  state.env.ENVIRONMENT = "production";
  state.env.PUBLIC_URL = ADMIN_ORIGIN;

  const { createAuth } = await import("@/auth");
  const auth = createAuth(state.env as never, `${ADMIN_ORIGIN}/`);
  for (const [key, account] of Object.entries(accounts)) {
    const created = await auth.api.signUpEmail({
      body: { email: account.email, password: PASSWORD, name: key },
    });
    account.id = created.user.id;
  }
  const setRole = (id: string, role: string) =>
    d1.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, id).run();
  await setRole(accounts.admin.id, "admin");
  await setRole(accounts.editor.id, "user");
  await setRole(accounts.customer.id, "guest");

  adminSessionCookie = sessionCookieOf(await signInOnCms(accounts.admin.email));

  adminRoute = (await import("@/routes/_backend/api/admin/$"))
    .Route as unknown as ServerRoute;
  themeBinaryRoute = (
    await import("@/routes/_backend/api/storefront/theme-binary-file")
  ).Route as unknown as ServerRoute;
  storeRoute = (await import("@/routes/_backend/api/store/$"))
    .Route as unknown as ServerRoute;
}, 180_000);

afterAll(async () => {
  await proxy?.dispose();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("/api/admin/* writes", () => {
  const post = (request: Request) =>
    adminRoute.options.server.handlers.POST!({ request });

  it("refuses a same-site storefront origin, and nothing is written", async () => {
    const before = await count("api_keys");
    const response = await post(adminPost("api-keys", sameSiteStorefront));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: "CROSS_ORIGIN_REQUEST",
    });
    expect(await count("api_keys")).toBe(before);
  });

  it("refuses an Origin that only starts with the CMS origin", async () => {
    const before = await count("api_keys");
    const response = await post(
      adminPost("api-keys", { origin: `${ADMIN_ORIGIN}.evil.com` }),
    );
    expect(response.status).toBe(403);
    expect(await count("api_keys")).toBe(before);
  });

  it("refuses a request with neither Sec-Fetch-Site nor Origin", async () => {
    const before = await count("api_keys");
    const response = await post(adminPost("api-keys", {}));
    expect(response.status).toBe(403);
    expect(await count("api_keys")).toBe(before);
  });

  it("refuses a text/plain body with 415, and nothing is written", async () => {
    const before = await count("api_keys");
    const response = await post(
      adminPost("api-keys", {
        ...sameOriginCms,
        "content-type": "text/plain;charset=UTF-8",
      }),
    );
    expect(response.status).toBe(415);
    expect(await count("api_keys")).toBe(before);
  });

  it("control: the CMS's own origin writes exactly one row", async () => {
    const before = await count("api_keys");
    const response = await post(adminPost("api-keys", sameOriginCms));
    expect(response.status).toBe(201);
    expect(await count("api_keys")).toBe(before + 1);
  });

  it("control: Origin alone, when it is the CMS's, writes", async () => {
    const before = await count("api_keys");
    const response = await post(adminPost("api-keys", { origin: ADMIN_ORIGIN }));
    expect(response.status).toBe(201);
    expect(await count("api_keys")).toBe(before + 1);
  });

  it("lets a Basic secret-key request through with no Origin", async () => {
    const created = await post(adminPost("api-keys", sameOriginCms));
    const { api_key } = (await created.json()) as {
      api_key: { token: string };
    };
    const before = await count("api_keys");
    const response = await post(
      new Request(`${ADMIN_ORIGIN}/api/admin/api-keys`, {
        method: "POST",
        headers: {
          authorization: `Basic ${api_key.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ title: "From a server", type: "publishable" }),
      }),
    );
    expect(response.status).toBe(201);
    expect(await count("api_keys")).toBe(before + 1);
  });

  // The check runs before routing, so every resource behind the dispatcher
  // is refused the same way; each is asked here so a route added in front of
  // the check would show up.
  it.each([
    "api-keys",
    "campaigns",
    "collections",
    "currencies",
    "customer-groups",
    "customers",
    "draft-orders/x/edit",
    "gift-cards",
    "inventory-items",
    "orders/x/cancel",
    "price-lists",
    "product-categories",
    "product-tags",
    "product-types",
    "products",
    "products/import",
    "promotions",
    "regions",
    "reservations",
    "returns",
    "sales-channels",
    "shipping-option-types",
    "shipping-profiles",
    "stock-locations",
    "store-credit-accounts",
    "stores/x",
    "tax-rates",
    "tax-regions",
  ])("refuses a same-site write to %s", async (path) => {
    for (const method of ["POST", "PATCH", "DELETE"] as const) {
      const handler = adminRoute.options.server.handlers[method]!;
      const response = await handler({
        request: new Request(`${ADMIN_ORIGIN}/api/admin/${path}`, {
          method,
          headers: { cookie: adminSessionCookie, ...sameSiteStorefront },
          body: "{}",
        }),
      });
      expect(response.status, `${method} ${path}`).toBe(403);
    }
  });
});

describe("the Theme binary upload", () => {
  const upload = (headers: Record<string, string>) =>
    themeBinaryRoute.options.server.handlers.POST!({
      request: new Request(
        `${ADMIN_ORIGIN}/api/storefront/theme-binary-file?storefrontId=s&themeId=t&path=public/a.png&expectedSourceGeneration=0&expectMissing=1`,
        {
          method: "POST",
          headers: {
            cookie: adminSessionCookie,
            "content-type": "application/octet-stream",
            ...headers,
          },
          body: new Uint8Array([1, 2, 3]),
        },
      ),
    });

  it("refuses a same-site storefront origin, and nothing is written", async () => {
    const before = await count("storefront_theme_files");
    const response = await upload(sameSiteStorefront);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: "CROSS_ORIGIN_REQUEST",
    });
    expect(await count("storefront_theme_files")).toBe(before);
  });

  it("refuses a request with neither header", async () => {
    expect((await upload({})).status).toBe(403);
  });

  it("control: the CMS's own origin reaches the upload itself", async () => {
    const response = await upload(sameOriginCms);
    // The upload's own answer (no such Theme), not the origin check's.
    expect(response.status).not.toBe(403);
    expect(await response.json()).not.toMatchObject({
      error: "CROSS_ORIGIN_REQUEST",
    });
  });
});

describe("the session cookie", () => {
  it("is a __Host- cookie: Secure, HttpOnly, Path=/, no Domain", async () => {
    const headers = await signInOnCms(accounts.admin.email);
    const line = headers
      .getSetCookie()
      .find((value) => value.startsWith(`${SESSION_COOKIE}=`))!;
    const attributes = line
      .split(";")
      .slice(1)
      .map((attribute) => attribute.trim().toLowerCase());
    expect(attributes).toContain("secure");
    expect(attributes).toContain("httponly");
    expect(attributes).toContain("path=/");
    expect(attributes.some((attribute) => attribute.startsWith("domain"))).toBe(
      false,
    );
    for (const value of headers.getSetCookie()) {
      expect(value.startsWith("__Secure-")).toBe(false);
    }
  });

  // Two cookies of one name: Better Auth (better-call 1.3.7 `parseCookies`)
  // reads the first and ignores the rest. A `__Host-` cookie cannot be set by
  // a sibling host, so a second copy cannot be tossed in from a storefront;
  // if one is there anyway, an invalid copy is either ignored or answers as
  // no session. It never answers as another account.
  it("with a second, invalid copy after it, still resolves the first", async () => {
    const { createAuth } = await import("@/auth");
    const auth = createAuth(state.env as never, `${ADMIN_ORIGIN}/`);
    const valid = adminSessionCookie;
    const invalid = `${SESSION_COOKIE}=tossed.invalid-signature`;
    const lastInvalid = await auth.api.getSession({
      headers: new Headers({ cookie: `${valid}; ${invalid}` }),
    });
    expect(lastInvalid?.user.id).toBe(accounts.admin.id);
  });

  it("with an invalid copy first, resolves to no session (fails safe)", async () => {
    const { createAuth } = await import("@/auth");
    const auth = createAuth(state.env as never, `${ADMIN_ORIGIN}/`);
    const invalid = `${SESSION_COOKIE}=tossed.invalid-signature`;
    const firstInvalid = await auth.api.getSession({
      headers: new Headers({ cookie: `${invalid}; ${adminSessionCookie}` }),
    });
    expect(firstInvalid).toBeNull();
  });
});

describe("sign-in on a storefront host", () => {
  async function storefrontSignIn(email: string) {
    const { createStorefrontAuth } = await import("@/auth");
    const url = `${STOREFRONT_ORIGIN}/api/auth/sign-in/email`;
    const auth = createStorefrontAuth(state.env as never, url, STOREFRONT_HOST);
    return auth.handler(
      new Request(url, {
        method: "POST",
        headers: {
          origin: STOREFRONT_ORIGIN,
          "content-type": "application/json",
        },
        body: JSON.stringify({ email, password: PASSWORD }),
      }),
    );
  }

  const sessionsOf = async (userId: string) =>
    (await d1
      .prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?")
      .bind(userId)
      .first<{ n: number }>())!.n;

  it.each(["admin", "editor"] as const)(
    "refuses the %s staff account, and creates no session",
    async (key) => {
      const before = await sessionsOf(accounts[key].id);
      const response = await storefrontSignIn(accounts[key].email);
      expect(response.status).toBe(403);
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(await sessionsOf(accounts[key].id)).toBe(before);
    },
  );

  it("signs a customer in, with a __Host- session cookie", async () => {
    const before = await sessionsOf(accounts.customer.id);
    const response = await storefrontSignIn(accounts.customer.email);
    expect(response.status).toBe(200);
    expect(sessionCookieOf(response.headers)).toMatch(
      new RegExp(`^${SESSION_COOKIE}=`),
    );
    expect(await sessionsOf(accounts.customer.id)).toBe(before + 1);
  });

  it("still signs staff in on the CMS host", async () => {
    expect(
      sessionCookieOf(await signInOnCms(accounts.editor.email)),
    ).toBeTruthy();
  });
});

describe("/api/store/* writes that carry the session cookie", () => {
  const claim = (headers: Record<string, string>) =>
    storeRoute.options.server.handlers.POST!({
      request: new Request(
        `${ADMIN_ORIGIN}/api/store/store-credit-accounts/claim`,
        {
          method: "POST",
          headers: { "content-type": "text/plain", ...headers },
          body: JSON.stringify({ code: "x" }),
        },
      ),
    });

  it("refuses one from a same-site storefront origin, and nothing is written", async () => {
    const before = await count("customers");
    const response = await claim({
      cookie: adminSessionCookie,
      ...sameSiteStorefront,
    });
    expect(response.status).toBe(403);
    expect(await count("customers")).toBe(before);
  });

  it("does not check a write that carries no platform cookie", async () => {
    const response = await claim(sameSiteStorefront);
    expect(response.status).not.toBe(403);
  });

  it("answers a preflight for reads only", async () => {
    const response = await storeRoute.options.server.handlers.OPTIONS!({
      request: new Request(`${ADMIN_ORIGIN}/api/store/carts`, {
        method: "OPTIONS",
      }),
    });
    expect(response.headers.get("access-control-allow-methods")).toBe(
      "GET, OPTIONS",
    );
  });
});
