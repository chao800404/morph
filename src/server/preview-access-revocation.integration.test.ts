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

import { env } from "cloudflare:workers";
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

/**
 * #214 P2d against the real thing: the application's own Better Auth
 * configuration (`createAuth`) on a real local D1 (Miniflare) with every
 * migration, driven through Better Auth's own API. What each auth change does
 * to Live Preview grants is read back from D1. Only the Durable Object the
 * close is pushed to is a stand-in, since there is no container here.
 */

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

const MIGRATIONS = join(process.cwd(), "drizzle");
const SECRET = "p2d-integration-secret-0123456789abcdef";
const ORIGIN = "http://localhost:3000";

let d1: D1Database;
let dispose: () => Promise<void>;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "preview-access-revocation-"));
  writeFileSync(
    join(dir, "wrangler.json"),
    JSON.stringify({
      name: "preview-access-revocation",
      compatibility_date: "2025-09-02",
      d1_databases: [
        {
          binding: "DATABASE",
          database_name: "p2d",
          database_id: "00000000-0000-0000-0000-000000000000",
        },
      ],
    }),
  );
  const proxy = await getPlatformProxy({
    configPath: join(dir, "wrangler.json"),
    persist: { path: join(dir, "state") },
  });
  d1 = (proxy.env as { DATABASE: D1Database }).DATABASE;
  dispose = () => proxy.dispose();
  for (const file of readdirSync(MIGRATIONS)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()) {
    for (const statement of readFileSync(join(MIGRATIONS, file), "utf8").split(
      "--> statement-breakpoint",
    )) {
      if (statement.trim()) await d1.prepare(statement.trim()).run();
    }
  }
  (env as unknown as { DATABASE: D1Database }).DATABASE = d1;
  (env as unknown as { PreviewSandbox: unknown }).PreviewSandbox = {};
}, 120_000);

afterAll(async () => {
  await dispose?.();
  rmSync(dir, { recursive: true, force: true });
});

/** Inserts a row, filling any other required column without a default. */
async function insertRow(table: string, values: Record<string, unknown>) {
  const { results } = await d1
    .prepare(`PRAGMA table_info(${table})`)
    .all<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: unknown;
      pk: number;
    }>();
  const row: Record<string, unknown> = { ...values };
  for (const column of results) {
    if (column.name in row || !column.notnull || column.dflt_value !== null)
      continue;
    row[column.name] = /INT|REAL|NUM/i.test(column.type)
      ? 0
      : `x-${column.name}`;
  }
  const names = Object.keys(row);
  await d1
    .prepare(
      `INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
    )
    .bind(...names.map((n) => row[n]))
    .run();
}

async function auth() {
  const { createAuth } = await import("@/auth");
  return createAuth({ DATABASE: d1, BETTER_AUTH_SECRET: SECRET }, ORIGIN);
}
type Auth = Awaited<ReturnType<typeof auth>>;

let n = 0;
/** A signed-in user, with the role given; returns the cookie headers. */
async function signedIn(a: Auth, role: string) {
  n += 1;
  const email = `p2d-${n}-${Date.now()}@example.test`;
  const password = "correct horse battery staple";
  await a.api.signUpEmail({ body: { email, password, name: `P2d ${n}` } });
  const { results } = await d1
    .prepare("SELECT id FROM users WHERE email = ?")
    .bind(email)
    .all<{ id: string }>();
  const userId = results[0]!.id;
  await d1
    .prepare("UPDATE users SET role = ? WHERE id = ?")
    .bind(role, userId)
    .run();
  const signIn = await a.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  const cookie = signIn.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const session = await d1
    .prepare(
      "SELECT id, token FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .bind(userId)
    .first<{ id: string; token: string }>();
  return {
    userId,
    sessionId: session!.id,
    token: session!.token,
    headers: new Headers({ cookie, origin: ORIGIN }),
  };
}

let grantSeq = 0;
let fixture: Promise<void> | null = null;
/** One storefront and Theme for every grant here. */
function storefrontAndTheme() {
  fixture ??= (async () => {
    const now = new Date().toISOString();
    await insertRow("storefronts", { id: "sf-p2d" });
    await insertRow("storefront_themes", {
      id: "th-p2d",
      storefront_id: "sf-p2d",
      name: "P2d",
      created_at: now,
      updated_at: now,
    });
  })();
  return fixture;
}
async function grantFor(
  who: { userId: string; sessionId: string },
  previewId = "preview-p2d",
) {
  grantSeq += 1;
  const now = new Date().toISOString();
  await storefrontAndTheme();
  const id = `grant-${grantSeq}`;
  await insertRow("storefront_preview_access_grants", {
    id,
    flow_id: `${grantSeq}`.padStart(32, "0"),
    kind: "iframe",
    token_hash: `${grantSeq}`.padStart(64, "0"),
    session_id: who.sessionId,
    user_id: who.userId,
    storefront_id: "sf-p2d",
    theme_id: "th-p2d",
    preview_id: previewId,
    preview_host: `pv-${previewId}.preview.example.test`,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    created_at: now,
    updated_at: now,
  });
  return id;
}

async function revokedAt(grantId: string) {
  const row = await d1
    .prepare(
      "SELECT revoked_at FROM storefront_preview_access_grants WHERE id = ?",
    )
    .bind(grantId)
    .first<{ revoked_at: string | null }>();
  return row?.revoked_at ?? null;
}

describe("Live Preview access ends with its session or user (#214 P2d, real Better Auth and D1)", () => {
  beforeEach(() => {
    push.calls = [];
    push.fail = false;
  });

  it("sign-out revokes the session's grants, then pushes their close", async () => {
    const a = await auth();
    const admin = await signedIn(a, "admin");
    const grant = await grantFor(admin);
    await a.api.signOut({ headers: admin.headers });
    expect(await revokedAt(grant)).not.toBeNull();
    expect(push.calls).toEqual([
      { previewId: "preview-p2d", grantIds: [grant] },
    ]);
  });

  it("revoking one session leaves the user's other session's grants alone", async () => {
    const a = await auth();
    const admin = await signedIn(a, "admin");
    const other = await signedIn(a, "admin");
    const mine = await grantFor(admin);
    const theirs = await grantFor(other);
    await a.api.revokeSession({
      headers: admin.headers,
      body: { token: admin.token },
    });
    expect(await revokedAt(mine)).not.toBeNull();
    expect(await revokedAt(theirs)).toBeNull();
  });

  it("a ban revokes every grant of the banned user", async () => {
    const a = await auth();
    const admin = await signedIn(a, "admin");
    const target = await signedIn(a, "admin");
    const grant = await grantFor(target, "preview-ban");
    await a.api.banUser({
      headers: admin.headers,
      body: { userId: target.userId },
    });
    expect(await revokedAt(grant)).not.toBeNull();
    expect(push.calls.some((c) => c.grantIds.includes(grant))).toBe(true);
  });

  it("a demotion revokes; a role change that keeps admin does not", async () => {
    const a = await auth();
    const admin = await signedIn(a, "admin");
    const target = await signedIn(a, "admin");
    const grant = await grantFor(target);
    await a.api.setRole({
      headers: admin.headers,
      body: { userId: target.userId, role: ["admin", "user"] },
    });
    expect(await revokedAt(grant)).toBeNull();
    await a.api.setRole({
      headers: admin.headers,
      body: { userId: target.userId, role: "user" },
    });
    expect(await revokedAt(grant)).not.toBeNull();
  });

  it("removing a user revokes the user's grants", async () => {
    const a = await auth();
    const admin = await signedIn(a, "admin");
    const target = await signedIn(a, "admin");
    const grant = await grantFor(target);
    await a.api.removeUser({
      headers: admin.headers,
      body: { userId: target.userId },
    });
    expect(await revokedAt(grant)).not.toBeNull();
  });

  it("a failed push does not fail the sign-out, and the revocation stands", async () => {
    const a = await auth();
    const admin = await signedIn(a, "admin");
    const grant = await grantFor(admin);
    push.fail = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      a.api.signOut({ headers: admin.headers }),
    ).resolves.toBeTruthy();
    expect(await revokedAt(grant)).not.toBeNull();
    const session = await d1
      .prepare("SELECT id FROM sessions WHERE id = ?")
      .bind(admin.sessionId)
      .first();
    expect(session).toBeNull();
  });
});
