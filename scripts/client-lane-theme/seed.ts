/**
 * Seeds the client lane's Starter 31 Themes into the run's own D1.
 *
 *   node --import tsx --import ./scripts/client-lane-theme/register.mjs \
 *     scripts/client-lane-theme/seed.ts
 *
 * Two uses, both on a client-lane run (see `scripts/e2e-client-lane-guard.mjs`):
 *
 * - run by `e2e/auth.setup.ts` once the store exists and before any editor
 *   has opened: the shared slot first (the Theme and index template ids the
 *   runner allocated and put in `E2E_EDITOR_PATH`, from
 *   `MORPH_E2E_CLIENT_LANE_SHARED`), then one Theme per dedicated slot, all
 *   written to `MORPH_E2E_CLIENT_LANE_THEMES` for the specs;
 * - run by `insertThrowawayTheme` (e2e/helpers/throwaway-theme.ts) for one
 *   throwaway, named by `MORPH_E2E_CLIENT_LANE_THROWAWAY` (its storefront,
 *   id, name and the test asking), appended to `MORPH_E2E_CLIENT_LANE_SEEDS`
 *   once verified. The index template id is printed on stdout.
 *
 * There is no HTTP entry: the product's DAL runs here, in Node, on the D1
 * binding `getPlatformProxy` opens over the run's state directory, the way
 * `src/lib/db/d1-batch.integration.test.ts` injects one. Each Theme is then
 * read back from the SQLite file itself (read-only, with a busy timeout) and
 * the run is refused unless it is a Starter 31 client Theme. Nothing is
 * written for the specs before that check passes.
 *
 * A seed that meets a busy database is retried: a dedicated slot with a
 * fresh id (a Theme a failed attempt left behind is never named anywhere,
 * so nothing opens it); the shared slot and a throwaway, whose ids the
 * caller already handed out, with the same id, taking up what the failed
 * attempt wrote (`resume` in `seedClientLaneTheme`). Either way the read-back
 * check decides.
 *
 * Reads MORPH_E2E_STATE_DIR, E2E_EDITOR_PATH (the storefront) and E2E_EMAIL
 * (the user the init is recorded under). Exits non-zero, saying why, on any
 * failure.
 */
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { env } from "cloudflare:workers";
import { getPlatformProxy } from "wrangler";

import {
  CLIENT_LANE_SEEDS_VAR,
  CLIENT_LANE_SHARED_SLOT,
  CLIENT_LANE_SHARED_VAR,
  CLIENT_LANE_STARTER_FIXTURE,
  CLIENT_LANE_STARTER_VERSION,
  CLIENT_LANE_THEMES_VAR,
  CLIENT_LANE_THEME_SLOTS,
  CLIENT_LANE_THROWAWAY_VAR,
  clientLaneEditorPath,
  clientLaneSeedLine,
  clientLaneThemeRefusal,
  contentSha256,
  fixtureFileDigests,
  parseSharedAllocation,
  storefrontIdFromEditorPath,
} from "../e2e-client-lane-guard.mjs";
import { seedVerifiedClientLaneTheme } from "../../src/lib/test-utils/client-lane-theme-seed";
import type { StarterWorkspaceFixture } from "../../src/lib/test-utils/starter-workspace-d1";

/** Same values as `wrangler.jsonc`'s DATABASE (see verify-published-artifact.mjs). */
const D1_CONFIG = {
  name: "morph-e2e-client-lane-seed",
  compatibility_date: "2026-03-24",
  d1_databases: [
    {
      binding: "DATABASE",
      database_name: "morph-d1-global",
      database_id: "43d5c881-bd19-4020-92cc-3945d8b5cb39",
    },
  ],
};

const PROVISION_TIMEOUT_MS = 60_000;
const BUSY_ATTEMPTS = 5;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`CLIENT_LANE_SEED: ${name} is not set.`);
  return value;
}

function runSqlite(stateDir: string): string {
  const dir = path.join(stateDir, "v3/d1/miniflare-D1DatabaseObject");
  const files = existsSync(dir)
    ? readdirSync(dir).filter(
        (name) => name.endsWith(".sqlite") && name !== "metadata.sqlite",
      )
    : [];
  if (files.length !== 1) {
    throw new Error(
      `CLIENT_LANE_SEED: expected the run's one D1 database in ${dir}, found ${files.length}.`,
    );
  }
  return path.join(dir, files[0]!);
}

/** Read-only, with the busy timeout `queryLocalD1` uses. */
function readRun(sqlite: string, sql: string, params: readonly unknown[]) {
  const db = new Database(sqlite, { readonly: true, timeout: 10_000 });
  try {
    return db.prepare(sql).all(...params) as Record<string, unknown>[];
  } finally {
    db.close();
  }
}

/** A lock the Worker held; workerd sets no busy timeout on the proxy's D1. */
function isBusy(error: unknown): boolean {
  const message = error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : String(error);
  return /SQLITE_BUSY|SQLITE_LOCKED|database is locked|D1_ERROR.*internal error/i.test(message);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Seeded = Awaited<ReturnType<typeof seedVerifiedClientLaneTheme>>;

async function main() {
  const stateDir = required("MORPH_E2E_STATE_DIR");
  const editorPath = required("E2E_EDITOR_PATH");
  const email = required("E2E_EMAIL");
  const throwawayText = process.env[CLIENT_LANE_THROWAWAY_VAR];
  const storefrontId = storefrontIdFromEditorPath(editorPath);
  if (!storefrontId) {
    throw new Error(`CLIENT_LANE_SEED: E2E_EDITOR_PATH names no storefront: ${editorPath}`);
  }

  const fixtureText = readFileSync(
    path.join(process.cwd(), CLIENT_LANE_STARTER_FIXTURE),
    "utf8",
  );
  const expected = fixtureFileDigests(fixtureText);
  const fixture = JSON.parse(fixtureText) as StarterWorkspaceFixture;

  const sqlite = runSqlite(stateDir);
  if (!throwawayText) {
    // The store is provisioned by the page auth.setup opened; wait until its
    // default Theme's workspace is in, so nothing else is writing.
    const deadline = Date.now() + PROVISION_TIMEOUT_MS;
    for (;;) {
      const [ready] = readRun(
        sqlite,
        `SELECT count(f.id) AS files FROM storefronts s
         JOIN storefront_themes t ON t.id = s.active_theme_id
         LEFT JOIN storefront_theme_files f ON f.theme_id = t.id AND f.deleted_at IS NULL
         WHERE s.id = ? AND s.deleted_at IS NULL`,
        [storefrontId],
      );
      if (Number(ready?.files ?? 0) > 0) break;
      if (Date.now() > deadline) {
        throw new Error(
          `CLIENT_LANE_SEED: storefront ${storefrontId} was not provisioned within ${PROVISION_TIMEOUT_MS / 1000}s.`,
        );
      }
      await sleep(500);
    }
  }
  const users = readRun(sqlite, "SELECT id FROM users WHERE email = ?", [email]);
  if (users.length !== 1) {
    throw new Error(`CLIENT_LANE_SEED: ${users.length} users hold E2E_EMAIL, not one.`);
  }
  const createdBy = String(users[0]!.id);

  /**
   * One Theme, retried on a busy database. `themeId` is fixed (resumed with
   * the same id) or a function (a fresh id per attempt).
   */
  async function seedOne(args: {
    label: string;
    themeId: string | (() => string);
    name: string;
    storefrontId: string;
    indexTemplateId?: string;
  }): Promise<Seeded & { themeId: string }> {
    for (let attempt = 1; ; attempt += 1) {
      const themeId =
        typeof args.themeId === "string" ? args.themeId : args.themeId();
      try {
        const result = await seedVerifiedClientLaneTheme(
          {
            storefrontId: args.storefrontId,
            themeId,
            name: args.name,
            createdBy,
            files: fixture.files,
            indexTemplateId: args.indexTemplateId,
            resume: typeof args.themeId === "string" && attempt > 1,
          },
          {
            query: (sql, params) => readRun(sqlite, sql, params),
            sha256: contentSha256,
            refusal: (evidence) => clientLaneThemeRefusal(evidence, expected),
          },
        );
        if (
          args.indexTemplateId !== undefined &&
          result.indexTemplateId !== args.indexTemplateId
        ) {
          throw new Error(
            `CLIENT_LANE_SEED: ${args.label}: index template ${result.indexTemplateId}, not ${args.indexTemplateId}.`,
          );
        }
        return { ...result, themeId };
      } catch (error) {
        if (!isBusy(error) || attempt >= BUSY_ATTEMPTS) throw error;
        console.error(`[client-lane-seed] ${args.label}: database busy, attempt ${attempt} of ${BUSY_ATTEMPTS}`);
        await sleep(500 * attempt);
      }
    }
  }

  const work = mkdtempSync(path.join(tmpdir(), "morph-client-lane-seed-"));
  const configPath = path.join(work, "wrangler.json");
  writeFileSync(configPath, JSON.stringify(D1_CONFIG));
  const proxy = await getPlatformProxy({
    configPath,
    persist: { path: path.join(stateDir, "v3") },
    remoteBindings: false,
  });
  try {
    const d1 = (proxy.env as { DATABASE: D1Database }).DATABASE;
    // The application's getDb() and raw env.DATABASE both read this.
    (env as unknown as { DATABASE: D1Database }).DATABASE = d1;
    const reached = await d1
      .prepare("SELECT count(*) AS n FROM storefronts WHERE id = ?1")
      .bind(storefrontId)
      .first<{ n: number }>();
    if (reached?.n !== 1) {
      throw new Error(
        `CLIENT_LANE_SEED: the D1 binding over ${stateDir} does not hold storefront ${storefrontId}; it is not the run's database.`,
      );
    }

    if (throwawayText) {
      await seedThrowaway(throwawayText, storefrontId, seedOne);
      return;
    }

    const outFile = required(CLIENT_LANE_THEMES_VAR);
    const sharedRead = parseSharedAllocation(process.env[CLIENT_LANE_SHARED_VAR]);
    if ("refusal" in sharedRead) {
      throw new Error(`CLIENT_LANE_SEED: ${sharedRead.refusal}.`);
    }
    const shared = sharedRead.shared;
    if (shared.storefrontId !== storefrontId || shared.editorPath !== editorPath) {
      throw new Error(
        `CLIENT_LANE_SEED: the shared slot (${shared.editorPath}) is not the E2E_EDITOR_PATH the specs got (${editorPath}).`,
      );
    }
    const themes: unknown[] = [];
    {
      const { seeded, indexTemplateId } = await seedOne({
        label: CLIENT_LANE_SHARED_SLOT,
        themeId: shared.themeId,
        name: `Client lane Starter ${CLIENT_LANE_STARTER_VERSION} (${CLIENT_LANE_SHARED_SLOT})`,
        storefrontId,
        indexTemplateId: shared.indexTemplateId,
      });
      const entry = {
        slot: CLIENT_LANE_SHARED_SLOT,
        storefrontId,
        themeId: shared.themeId,
        indexTemplateId,
      };
      themes.push({ ...entry, editorPath: clientLaneEditorPath(entry), seeded });
      console.log(
        `[client-lane-seed] ${CLIENT_LANE_SHARED_SLOT}: Theme ${shared.themeId} (E2E_EDITOR_PATH), ${seeded.files.length} files of Starter ${CLIENT_LANE_STARTER_VERSION}, no recorded runtime`,
      );
    }
    for (const slot of CLIENT_LANE_THEME_SLOTS) {
      const { seeded, indexTemplateId, themeId } = await seedOne({
        label: slot,
        themeId: randomUUID,
        name: `Client lane Starter ${CLIENT_LANE_STARTER_VERSION} (${slot})`,
        storefrontId,
      });
      const entry = { slot, storefrontId, themeId, indexTemplateId };
      themes.push({ ...entry, editorPath: clientLaneEditorPath(entry), seeded });
      console.log(
        `[client-lane-seed] ${slot}: Theme ${themeId}, ${seeded.files.length} files of Starter ${CLIENT_LANE_STARTER_VERSION}, no recorded runtime`,
      );
    }
    const record = {
      version: 1,
      starterVersion: CLIENT_LANE_STARTER_VERSION,
      fixture: CLIENT_LANE_STARTER_FIXTURE,
      themes,
    };
    const partial = `${outFile}.partial`;
    writeFileSync(partial, `${JSON.stringify(record, null, 2)}\n`);
    renameSync(partial, outFile);
  } finally {
    await proxy.dispose();
    rmSync(work, { recursive: true, force: true });
  }
}

/** One throwaway, as `insertThrowawayTheme` asks for it on the lane. */
async function seedThrowaway(
  text: string,
  storefrontId: string,
  seedOne: (args: {
    label: string;
    themeId: string;
    name: string;
    storefrontId: string;
  }) => Promise<Seeded & { themeId: string }>,
) {
  const seedsFile = required(CLIENT_LANE_SEEDS_VAR);
  let asked: { storefrontId?: unknown; themeId?: unknown; name?: unknown; test?: unknown };
  try {
    asked = JSON.parse(text);
  } catch {
    throw new Error(`CLIENT_LANE_SEED: ${CLIENT_LANE_THROWAWAY_VAR} is not JSON.`);
  }
  if (
    typeof asked.themeId !== "string" ||
    typeof asked.name !== "string" ||
    asked.storefrontId !== storefrontId
  ) {
    throw new Error(
      `CLIENT_LANE_SEED: ${CLIENT_LANE_THROWAWAY_VAR} names no Theme of storefront ${storefrontId}: ${text.slice(0, 300)}`,
    );
  }
  const { seeded, indexTemplateId } = await seedOne({
    label: `throwaway ${asked.themeId}`,
    themeId: asked.themeId,
    name: asked.name,
    storefrontId,
  });
  // Only now, after the read-back passed: the guard registers what is here.
  appendFileSync(
    seedsFile,
    clientLaneSeedLine({
      storefrontId,
      themeId: asked.themeId,
      indexTemplateId,
      name: asked.name,
      test: typeof asked.test === "string" ? asked.test : "",
      seeded,
    }),
  );
  process.stdout.write(`${JSON.stringify({ themeId: asked.themeId, indexTemplateId })}\n`);
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
