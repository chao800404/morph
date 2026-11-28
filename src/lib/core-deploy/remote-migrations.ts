// The repo's migration rules (scripts/pending-migrations.mjs); a plain .mjs with no types.
// @ts-expect-error TS7016
import * as rules from "../../../scripts/pending-migrations.mjs";
import { CloudflareReadError, type InventoryApi } from "./cloudflare-api";

/**
 * The remote migration check a Core deploy runs before it builds — the same
 * rule as `scripts/check-pending-migrations.mjs --remote` (every migration
 * file applied, nothing applied that this checkout lacks, no number used
 * twice), read from the validated target's database id through the D1 API.
 *
 * Not through `wrangler d1 execute DATABASE`: that resolves the database from
 * whatever config Wrangler discovers, and loads `.env` files that can select
 * another environment (`CLOUDFLARE_ENV`), so it could check a different
 * database than the one the deploy and the inventory use.
 */
export const APPLIED_MIGRATIONS_SQL = "SELECT name FROM d1_migrations ORDER BY id";

type Rules = {
  migrationFiles(entries: string[]): string[];
  duplicateMigrationNumbers(files: string[]): unknown[];
  compareMigrations(input: { files: string[]; applied: string[] }): { pending: string[]; unknown: string[] };
  describeMigrationState(input: {
    pending: string[];
    unknown: string[];
    duplicates: unknown[];
    target: string | null;
  }): { ok: boolean; lines: string[] };
};
const migrationRules = rules as Rules;

export async function checkRemoteMigrations(input: {
  api: InventoryApi;
  databaseId: string;
  /** The entries of the migrations directory. */
  entries: string[];
}): Promise<{ ok: boolean; lines: string[] }> {
  const files = migrationRules.migrationFiles(input.entries);
  const duplicates = migrationRules.duplicateMigrationNumbers(files);
  let applied: string[];
  try {
    const rows = await input.api.queryD1(input.databaseId, APPLIED_MIGRATIONS_SQL);
    applied = rows.map((row) => row.name as string);
    if (applied.some((name) => typeof name !== "string")) {
      return { ok: false, lines: ["Could not read the applied migrations: a d1_migrations row has no name."] };
    }
  } catch (error) {
    // A database with no d1_migrations table has applied none; anything else
    // that is not a result is a failure, never "nothing applied".
    if (error instanceof CloudflareReadError && /no such table: d1_migrations/.test(error.message)) {
      applied = [];
    } else {
      return {
        ok: false,
        lines: [`Could not read the applied migrations: ${error instanceof Error ? error.message : String(error)}`],
      };
    }
  }
  const { pending, unknown } = migrationRules.compareMigrations({ files, applied });
  return migrationRules.describeMigrationState({ pending, unknown, duplicates, target: "remote" });
}
