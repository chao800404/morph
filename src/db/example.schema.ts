/**
 * Example custom schema
 *
 * This is an example of how to add your own tables to the database.
 * To use this:
 * 1. Uncomment the code below
 * 2. Import it in ./schema.ts
 * 3. Add it to the schema export
 * 4. Run `pnpm db:generate` to create migrations
 * 5. Run `pnpm db:migrate:dev` to apply migrations
 *
 * Timestamps come from `./columns`, which is not a detail of the example. This
 * file used to declare its own as `integer(..., { mode: "timestamp" })` — epoch
 * *seconds* — which no table in this schema uses, and to fill them with
 * `$defaultFn`, which contradicts what `columns.ts` says about timestamps being
 * written by the DAL so that a row's `updatedAt` matches the value the request
 * already computed. A template is copied more often than it is read, so it
 * taught a third convention to everyone who used it.
 */

/*
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { timestamps } from "./columns";
import { users } from "./auth.schema";

export const posts = sqliteTable("posts", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  authorId: text("author_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  ...timestamps,
});

export const comments = sqliteTable("comments", {
  id: text("id").primaryKey(),
  content: text("content").notNull(),
  postId: text("post_id")
    .notNull()
    .references(() => posts.id, { onDelete: "cascade" }),
  authorId: text("author_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  ...timestamps,
});
*/
