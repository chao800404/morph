// @ts-check
/**
 * The one account an editor end-to-end run signs in as.
 *
 * Deliberately small. A seed that also laid out the store, its theme and the
 * starter workspace would be a second copy of provisioning the app already
 * does — `ensureDefault` creates the storefront and theme rows, and
 * `ensureStoredStarterPreview` fills the workspace — and the copy would drift
 * the first time a starter version moved. So this writes the account, and the
 * run reaches the store the way a person does: by opening a page that asks for
 * it. `auth.setup.ts` does that before the editor.
 *
 * The password hash comes from `better-auth/crypto`, which exports the same
 * `hashPassword` the sign-in path verifies against. Re-deriving scrypt
 * parameters here would work until Better Auth changed them, and then fail as
 * "wrong password" with nothing to point at.
 *
 * Idempotent: the same ids every time, and every write is an upsert, so a
 * developer can re-run it against a state directory that already has an
 * account without clearing anything first.
 *
 * Usage:
 *   node scripts/seed-e2e.mjs --persist-to <dir> --env <wrangler-env>
 *
 * Reads E2E_EMAIL and E2E_PASSWORD, which must be the same values Playwright
 * signs in with. It prints no secret: the password is read, hashed, and handed
 * to SQLite, never echoed.
 */

import { execFileSync } from "node:child_process";
import { hashPassword } from "better-auth/crypto";

/** Fixed so a re-run updates the same rows instead of making new ones. */
const USER_ID = "00000000-0000-4000-8000-00000000e2e1";
const ACCOUNT_ID = "00000000-0000-4000-8000-00000000e2e2";
const PRODUCT_ID = "00000000-0000-4000-8000-00000000e2e3";
/** Written by `currency.dal`, and the channel the storefront reads through. */
const SALES_CHANNEL_ID = "00000000-0000-4000-8000-000000000001";

function readArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag.startsWith("--")) args.set(flag.slice(2), argv[index + 1]);
  }
  return args;
}

function quote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function main() {
  const args = readArgs(process.argv.slice(2));
  const persistTo = args.get("persist-to");
  const env = args.get("env") ?? "local_preview_e2e";
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;

  if (!persistTo) {
    throw new Error(
      "SEED_MISSING_PERSIST_TO: pass --persist-to <dir>, the same directory the dev server is given. Without it the seed writes to the developer's own .wrangler/state.",
    );
  }
  // Wrangler resolves `--persist-to` against the working directory and the Vite
  // plugin resolves `persistState.path` against Vite's root. They are not the
  // same directory, so a relative path silently splits the run in two: the
  // migrations and this seed land in one place and the dev server reads
  // another, which looks like an empty database rather than a path mistake.
  if (!persistTo.startsWith("/")) {
    throw new Error(
      `SEED_RELATIVE_PERSIST_TO: "${persistTo}" must be absolute.`,
    );
  }
  if (!email || !password) {
    throw new Error(
      "SEED_MISSING_CREDENTIALS: set E2E_EMAIL and E2E_PASSWORD. They are the values Playwright signs in with, so the seed and the sign-in have to read the same ones.",
    );
  }

  const hash = await hashPassword(password);
  // Two conventions live in this schema, and mixing them does not fail at the
  // insert. `auth.schema.ts` stores epoch milliseconds
  // (`integer(..., { mode: "timestamp_ms" })`), while `product.schema.ts` and
  // `link.schema.ts` store ISO strings (`text("created_at")`). SQLite accepts
  // either value in either column, so a number written into a text timestamp is
  // read back as `new Date("1758...")` — an Invalid Date that survives the list
  // query, because `JSON.stringify` turns it into `null`, and then throws
  // "Invalid time value" the moment the detail DTO calls `.toISOString()`. The
  // preview reports that as "This product is temporarily unavailable".
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  // `role` is `admin` because every editor server function runs behind
  // `commerceAdminMiddleware`. A `user` account signs in and then fails every
  // request the editor makes, which reads as a broken editor rather than as a
  // seed that chose the wrong role.
  // The catalog route renders nothing without one. `store-catalog.dal` asks for
  // products that are published *and* linked to the storefront's sales channel,
  // so both rows are needed — a published product with no link is invisible,
  // which reads as a broken preview rather than as a missing link.
  //
  // The channel row itself is not created here: `currency.dal` writes it, along
  // with the store, the storefront and its theme, when the editor's first page
  // asks for them. Only the link is ours.
  const sql = [
    `INSERT INTO users (id, name, email, email_verified, role, created_at, updated_at)`,
    `VALUES (${quote(USER_ID)}, 'E2E', ${quote(email)}, 1, 'admin', ${now}, ${now})`,
    `ON CONFLICT(id) DO UPDATE SET email = excluded.email, role = 'admin', email_verified = 1, updated_at = ${now};`,
    `INSERT INTO accounts (id, account_id, provider_id, user_id, password, created_at, updated_at)`,
    `VALUES (${quote(ACCOUNT_ID)}, ${quote(USER_ID)}, 'credential', ${quote(USER_ID)}, ${quote(hash)}, ${now}, ${now})`,
    `ON CONFLICT(id) DO UPDATE SET password = excluded.password, updated_at = ${now};`,
    `INSERT INTO products (id, title, handle, status, is_giftcard, discountable, created_by, updated_by, created_at, updated_at)`,
    `VALUES (${quote(PRODUCT_ID)}, 'E2E Product', 'e2e-product', 'published', 0, 1, ${quote(USER_ID)}, ${quote(USER_ID)}, ${quote(nowIso)}, ${quote(nowIso)})`,
    `ON CONFLICT(id) DO UPDATE SET status = 'published', created_at = ${quote(nowIso)}, updated_at = ${quote(nowIso)};`,
    `INSERT INTO product_sales_channels (product_id, sales_channel_id, created_at, updated_at)`,
    `VALUES (${quote(PRODUCT_ID)}, ${quote(SALES_CHANNEL_ID)}, ${quote(nowIso)}, ${quote(nowIso)})`,
    `ON CONFLICT(product_id, sales_channel_id) DO UPDATE SET updated_at = ${quote(nowIso)};`,
  ].join("\n");

  execFileSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      "DATABASE",
      "--local",
      "--env",
      env,
      "--persist-to",
      persistTo,
      "--command",
      sql,
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );

  console.log(`[seed-e2e] account ready for ${email} (role: admin), 1 published product linked to the storefront channel`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
