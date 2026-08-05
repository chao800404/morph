import { text } from "drizzle-orm/sqlite-core";
import type { Metadata } from "./json";

/**
 * Column groups shared by every commerce table.
 *
 * `product.schema.ts` spells these out per table; it predates the other
 * modules and has 15 tables. The commerce modules translated from Medusa have
 * about seventy between them, and repeating the same three columns that many
 * times buries the columns that actually differ. Drizzle spreads a plain
 * object into a table definition, so this is the same declaration, named.
 *
 * Timestamps are ISO strings written by the DAL, not SQLite defaults — the
 * same choice `asset.schema.ts` made, so a row's `updatedAt` matches the value
 * the request already computed rather than the moment the statement ran.
 */
export const timestamps = {
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  /** Soft delete. Every read must filter on it — see rules.md §4. */
  deletedAt: text("deleted_at"),
};

/**
 * Store-defined key/value pairs the core schema does not model.
 *
 * Readable by the storefront by design, so it must never hold API keys, cost
 * prices, contract terms or personal data.
 */
export const metadata = () =>
  text("metadata", { mode: "json" }).$type<Metadata>();

/** Free-form JSON owned by a provider (payment, tax, fulfillment). */
export const providerData = (name: string) =>
  text(name, { mode: "json" }).$type<Metadata>();
