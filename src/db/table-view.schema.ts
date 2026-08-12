import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "./auth.schema";

export interface TableViewConfiguration {
  columnOrder: string[];
  hiddenColumns: string[];
}

export const userTableViews = sqliteTable(
  "user_table_views",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tableKey: text("table_key").notNull(),
    name: text("name").notNull().default("Default"),
    configuration: text("configuration", { mode: "json" })
      .$type<TableViewConfiguration>()
      .notNull(),
    isDefault: integer("is_default", { mode: "boolean" })
      .notNull()
      .default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("user_table_views_user_table_name_uq").on(
      table.userId,
      table.tableKey,
      table.name,
    ),
  ],
);
