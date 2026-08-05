import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { metadata, timestamps } from "./columns";

/**
 * Customers, their addresses and their groups.
 *
 * Translated from Medusa's Customer Module; see `region.schema.ts` for the
 * translation rules that apply to every commerce module here.
 *
 * A customer is not an authenticated account. `hasAccount` records whether one
 * exists, and the account itself lives in the Better Auth tables — which is why
 * there is no foreign key to `user`: a guest checkout produces a customer row
 * with no account at all.
 */
export const customers = sqliteTable(
  "customers",
  {
    id: text("id").primaryKey(),
    companyName: text("company_name"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    email: text("email"),
    phone: text("phone"),
    hasAccount: integer("has_account", { mode: "boolean" })
      .notNull()
      .default(false),
    metadata: metadata(),
    createdBy: text("created_by"),
    ...timestamps,
  },
  (table) => [
    // Unique on the pair, not on the email: the same person may check out as a
    // guest and later register, and Medusa keeps both rows.
    uniqueIndex("customers_active_email_account_unique")
      .on(table.email, table.hasAccount)
      .where(sql`${table.deletedAt} IS NULL AND ${table.email} IS NOT NULL`),
    index("customers_active_idx").on(table.deletedAt),
  ],
);

export const customerAddresses = sqliteTable(
  "customer_addresses",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    /** The author's own label for the address, e.g. "Office". */
    addressName: text("address_name"),
    isDefaultShipping: integer("is_default_shipping", { mode: "boolean" })
      .notNull()
      .default(false),
    isDefaultBilling: integer("is_default_billing", { mode: "boolean" })
      .notNull()
      .default(false),
    company: text("company"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    address1: text("address_1"),
    address2: text("address_2"),
    city: text("city"),
    countryCode: text("country_code"),
    province: text("province"),
    postalCode: text("postal_code"),
    phone: text("phone"),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    index("customer_addresses_customer_active_idx").on(
      table.customerId,
      table.deletedAt,
    ),
    // At most one default of each kind per customer, enforced by the index
    // rather than by the DAL so a concurrent write cannot produce two.
    uniqueIndex("customer_addresses_one_default_shipping")
      .on(table.customerId)
      .where(sql`${table.isDefaultShipping} = 1 AND ${table.deletedAt} IS NULL`),
    uniqueIndex("customer_addresses_one_default_billing")
      .on(table.customerId)
      .where(sql`${table.isDefaultBilling} = 1 AND ${table.deletedAt} IS NULL`),
  ],
);

/** A segment, e.g. "Wholesale". Price lists and promotions target these. */
export const customerGroups = sqliteTable(
  "customer_groups",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    metadata: metadata(),
    createdBy: text("created_by"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("customer_groups_active_name_unique")
      .on(table.name)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

/**
 * Membership.
 *
 * An entity rather than a composite-key join table because Medusa records who
 * added the customer and when — a group can be the reason someone gets a price,
 * so the audit trail is worth a row id.
 */
export const customerGroupCustomers = sqliteTable(
  "customer_group_customers",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    customerGroupId: text("customer_group_id")
      .notNull()
      .references(() => customerGroups.id, { onDelete: "cascade" }),
    createdBy: text("created_by"),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("customer_group_customers_unique")
      .on(table.customerGroupId, table.customerId)
      .where(sql`${table.deletedAt} IS NULL`),
    index("customer_group_customers_customer_idx").on(table.customerId),
  ],
);
