import { sql } from "drizzle-orm";
import {
  check,
  index,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { timestamps } from "./columns";

/**
 * `publishable` keys are safe in a storefront bundle and only resolve a sales
 * channel; `secret` keys authenticate an admin caller and are not.
 */
export type ApiKeyType = "publishable" | "secret";

/**
 * API keys.
 *
 * Translated from Medusa's API Key Module; see `region.schema.ts` for the
 * translation rules.
 *
 * The columns encode how a key must be handled, so they are worth reading as
 * rules rather than fields:
 *
 * - `token` is a **hash**, never the key itself. The plaintext is shown once,
 *   at creation, and cannot be recovered afterwards — that is the whole point
 *   of `salt` being here and the value not being.
 * - `redacted` is the display form, e.g. `pk_1a2b...ef34`. Every list and
 *   detail view reads this column. Nothing in the dashboard should ever render
 *   `token`.
 * - Revoking sets `revokedAt` and `revokedBy` rather than deleting the row: an
 *   audit needs to say which key made a call last month, and a deleted row
 *   cannot.
 *
 * A publishable key's sales channels are joined in `link.schema.ts`.
 */
export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    /** A hash of the key. See the note above — never the key itself. */
    token: text("token").notNull(),
    salt: text("salt").notNull(),
    /** The masked form, and the only one safe to display. */
    redacted: text("redacted").notNull(),
    title: text("title").notNull(),
    type: text("type").$type<ApiKeyType>().notNull(),
    lastUsedAt: text("last_used_at"),
    createdBy: text("created_by").notNull(),
    revokedBy: text("revoked_by"),
    revokedAt: text("revoked_at"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("api_keys_token_unique").on(table.token),
    // Authentication looks up a live key by hash; the partial index keeps
    // revoked ones out of that scan.
    index("api_keys_type_live_idx")
      .on(table.type)
      .where(sql`${table.revokedAt} IS NULL AND ${table.deletedAt} IS NULL`),
    index("api_keys_redacted_idx").on(table.redacted),
    check(
      "api_keys_type_check",
      sql`${table.type} IN ('publishable', 'secret')`,
    ),
  ],
);
