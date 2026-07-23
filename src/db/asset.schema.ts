import { sql } from "drizzle-orm";
import {
  AnySQLiteColumn,
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export type AssetType = "image" | "video" | "rive" | "model";

export type AssetMetadata = {
  version: 1;
  r2Key: string;
};

// Shared CMS folders. idPath is intentionally denormalized so D1 can fetch an
// entire subtree with one indexed prefix query.
export const assetFolders = sqliteTable(
  "asset_folders",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    idPath: text("id_path").notNull(),
    parentId: text("parent_id").references(
      (): AnySQLiteColumn => assetFolders.id,
      { onDelete: "set null" },
    ),
    path: text("path").notNull(),
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("asset_folders_parent_active_idx").on(
      table.parentId,
      table.deletedAt,
    ),
    uniqueIndex("asset_folders_id_path_unique").on(table.idPath),
    uniqueIndex("asset_folders_active_path_unique")
      .on(table.path)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

export const assets = sqliteTable(
  "assets",
  {
    id: text("id").primaryKey(),
    folderId: text("folder_id").references(() => assetFolders.id, {
      onDelete: "set null",
    }),
    type: text("type").$type<AssetType>().notNull(),
    name: text("name").notNull(),
    originalName: text("original_name").notNull(),
    alt: text("alt"),
    caption: text("caption"),
    tags: text("tags", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    mimeType: text("mime_type"),
    size: integer("size").notNull(),
    url: text("url").notNull(),
    width: integer("width"),
    height: integer("height"),
    duration: integer("duration"),
    thumbnailUrl: text("thumbnail_url"),
    metadata: text("metadata", { mode: "json" })
      .$type<AssetMetadata>()
      .notNull(),
    uploadedBy: text("uploaded_by").notNull(),
    updatedBy: text("updated_by").notNull().default("system"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("assets_folder_active_idx").on(table.folderId, table.deletedAt),
    index("assets_type_active_idx").on(table.type, table.deletedAt),
    index("assets_uploaded_by_idx").on(table.uploadedBy),
    uniqueIndex("assets_url_unique").on(table.url),
    check(
      "assets_type_check",
      sql`${table.type} IN ('image', 'video', 'rive', 'model')`,
    ),
    check("assets_size_check", sql`${table.size} > 0`),
  ],
);
