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

/**
 * The two timestamp conventions this schema keeps, one function each.
 *
 * `auth.schema.ts` stores epoch milliseconds in
 * `integer(..., { mode: "timestamp_ms" })`. `product.schema.ts`,
 * `link.schema.ts` and `columns.ts` store ISO-8601 in `text("created_at")`.
 * Every TypeScript writer is held to this by Drizzle — a number into a text
 * column is `TS2322: Type 'number' is not assignable to type 'string'` — but
 * this file builds SQL by hand, so nothing types it and nothing checks it.
 *
 * That is not hypothetical. This seed wrote `Date.now()` into all four tables.
 * SQLite stored the numbers without complaint; the catalog list survived them,
 * because `JSON.stringify` turns an Invalid Date into `null`; and the detail
 * DTO threw `Invalid time value` from `.toISOString()` three layers away,
 * arriving as the Theme's "This product is temporarily unavailable". Naming the
 * two conversions is the smallest thing that makes the choice deliberate at
 * every call site, and `verifyTimestamps` below is what makes a wrong one fail
 * here rather than there.
 */
const epochMs = (at) => at.getTime();
const iso = (at) => at.toISOString();

/**
 * Reads the seeded rows back and fails if a timestamp cannot survive the trip.
 *
 * The check is the operation that broke: the DTO path calls `.toISOString()` on
 * whatever the column yields, so this does the same, and compares the storage
 * class SQLite actually chose against the one the schema declares. A number in
 * a text column reports `typeof` as `integer` and gives an Invalid Date, and
 * both are caught on the row that was just written.
 */
async function verifyTimestamps(run) {
  const expectations = [
    { table: "users", id: `id = ${quote(USER_ID)}`, storage: "integer" },
    { table: "accounts", id: `id = ${quote(ACCOUNT_ID)}`, storage: "integer" },
    { table: "products", id: `id = ${quote(PRODUCT_ID)}`, storage: "text" },
    {
      table: "product_sales_channels",
      id: `product_id = ${quote(PRODUCT_ID)}`,
      storage: "text",
    },
  ];

  for (const { table, id, storage } of expectations) {
    const [row] = run(
      `SELECT typeof(created_at) AS created_type, created_at, typeof(updated_at) AS updated_type, updated_at FROM ${table} WHERE ${id};`,
    );
    if (!row) throw new Error(`SEED_ROW_MISSING: ${table} has no seeded row.`);

    for (const column of ["created", "updated"]) {
      const actual = row[`${column}_type`];
      const value = row[`${column}_at`];
      if (actual !== storage) {
        throw new Error(
          `SEED_TIMESTAMP_STORAGE: ${table}.${column}_at is stored as ${actual}, but its schema declares ${storage}. SQLite accepts either; the DTO that reads it does not.`,
        );
      }
      const date = new Date(storage === "text" ? value : Number(value));
      if (Number.isNaN(date.getTime())) {
        throw new Error(
          `SEED_TIMESTAMP_UNREADABLE: ${table}.${column}_at is ${JSON.stringify(value)}, which is an Invalid Date. This is what the detail DTO throws "Invalid time value" on.`,
        );
      }
      if (storage === "text" && date.toISOString() !== value) {
        throw new Error(
          `SEED_TIMESTAMP_NOT_ISO: ${table}.${column}_at is ${JSON.stringify(value)}, which is readable but not the ISO-8601 the DAL writes. Values in two formats sort against each other wrongly.`,
        );
      }
    }
  }
}

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
  // An empty `--env` means Wrangler's default environment, which is where the
  // container transport lives: `containers` and `durable_objects` are declared
  // at the top level and a named environment does not inherit them. Passing
  // `--env ""` to Wrangler would not say that, so the flag is dropped instead.
  const env = args.has("env") ? args.get("env") : "local_preview_e2e";
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
  const at = new Date();

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
    `VALUES (${quote(USER_ID)}, 'E2E', ${quote(email)}, 1, 'admin', ${epochMs(at)}, ${epochMs(at)})`,
    `ON CONFLICT(id) DO UPDATE SET email = excluded.email, role = 'admin', email_verified = 1, updated_at = ${epochMs(at)};`,
    `INSERT INTO accounts (id, account_id, provider_id, user_id, password, created_at, updated_at)`,
    `VALUES (${quote(ACCOUNT_ID)}, ${quote(USER_ID)}, 'credential', ${quote(USER_ID)}, ${quote(hash)}, ${epochMs(at)}, ${epochMs(at)})`,
    `ON CONFLICT(id) DO UPDATE SET password = excluded.password, updated_at = ${epochMs(at)};`,
    `INSERT INTO products (id, title, handle, status, is_giftcard, discountable, created_by, updated_by, created_at, updated_at)`,
    `VALUES (${quote(PRODUCT_ID)}, 'E2E Product', 'e2e-product', 'published', 0, 1, ${quote(USER_ID)}, ${quote(USER_ID)}, ${quote(iso(at))}, ${quote(iso(at))})`,
    `ON CONFLICT(id) DO UPDATE SET status = 'published', created_at = ${quote(iso(at))}, updated_at = ${quote(iso(at))};`,
    `INSERT INTO product_sales_channels (product_id, sales_channel_id, created_at, updated_at)`,
    `VALUES (${quote(PRODUCT_ID)}, ${quote(SALES_CHANNEL_ID)}, ${quote(iso(at))}, ${quote(iso(at))})`,
    `ON CONFLICT(product_id, sales_channel_id) DO UPDATE SET updated_at = ${quote(iso(at))};`,
  ].join("\n");

  /** One statement batch against the run's database. `json` returns its rows. */
  const execute = (command, json = false) => {
    const output = execFileSync(
      "npx",
      [
        "wrangler",
        "d1",
        "execute",
        "DATABASE",
        "--local",
        ...(env ? ["--env", env] : []),
        "--persist-to",
        persistTo,
        ...(json ? ["--json"] : []),
        "--command",
        command,
      ],
      { stdio: ["ignore", "pipe", "inherit"] },
    ).toString();
    if (!json) return [];
    // Wrangler prints its configuration warnings before the JSON, so the array
    // is found rather than assumed to start the output.
    const start = output.indexOf("[");
    if (start === -1) throw new Error("SEED_NO_JSON: wrangler returned no result array.");
    return JSON.parse(output.slice(start)).flatMap((result) => result.results ?? []);
  };

  execute(sql);
  await verifyTimestamps((command) => execute(command, true));

  console.log(`[seed-e2e] account ready for ${email} (role: admin), 1 published product linked to the storefront channel`);
  console.log("[seed-e2e] timestamps verified: every seeded row reads back through the conversion its schema declares");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
