import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Asset folders table - folder management for media assets (shared across all users)
export const assetFolders = sqliteTable("asset_folders", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"), // Folder description
    idPath: text("id_path").notNull(), // ID path for easy querying (e.g., "/root-id/child-id")
    parentId: text("parent_id"), // Parent folder ID for nested structure (null = root folder)
    path: text("path").notNull(), // Full path for easy querying (e.g., "/Images/Photos")
    childCount: integer("child_count").default(0).notNull(), // Number of child folders
    assetCount: integer("asset_count").default(0).notNull(), // Number of assets in this folder
    createdBy: text("created_by").notNull(), // User ID who created this folder
    updatedBy: text("updated_by").notNull(), // User ID who last updated this folder
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
});

// Indexes for asset_folders table
export const assetFoldersParentIdIdx = index("asset_folders_parent_id_idx").on(assetFolders.parentId);
export const assetFoldersPathIdx = index("asset_folders_path_idx").on(assetFolders.path);
export const assetFoldersIdPathIdx = index("asset_folders_id_path_idx").on(assetFolders.idPath);

// Assets table - unified asset table for images, videos, .riv, .obj files (shared across all users)
export const assets = sqliteTable("assets", {
    id: text("id").primaryKey(),
    folderId: text("folder_id"), // Parent folder ID (null = root)
    type: text("type").notNull(), // Asset type: image, video, rive, model
    name: text("name").notNull(), // System file name
    originalName: text("original_name").notNull(), // Original file name
    alt: text("alt"), // Alternative text for accessibility
    caption: text("caption"), // Asset description
    tags: text("tags"), // Comma-separated tags
    mimeType: text("mime_type"), // MIME type
    size: integer("size").notNull(), // File size in bytes
    sizeFormatted: text("size_formatted").notNull(), // Human-readable size
    url: text("url").notNull(), // Asset URL
    width: integer("width"), // Image/video width
    height: integer("height"), // Image/video height
    duration: integer("duration"), // Video duration in seconds
    thumbnailUrl: text("thumbnail_url"), // Thumbnail URL
    metadata: text("metadata"), // JSON metadata
    customMetadata: text("custom_metadata"), // Custom metadata
    uploadedBy: text("uploaded_by").notNull(), // User ID who uploaded this asset
    updatedBy: text("updated_by").notNull().default("system"), // User ID who last updated this asset
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
});

// Indexes for assets table
export const assetsFolderIdIdx = index("assets_folder_id_idx").on(assets.folderId);
export const assetsTypeIdx = index("assets_type_idx").on(assets.type);
export const assetsFolderTypeIdx = index("assets_folder_type_idx").on(assets.folderId, assets.type);

// Asset collections table - for organizing assets
export const assetCollections = sqliteTable("asset_collections", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    userId: text("user_id").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
});

// Asset collection items table - many-to-many relationship
export const assetCollectionItems = sqliteTable("asset_collection_items", {
    id: text("id").primaryKey(),
    collectionId: text("collection_id").notNull(),
    assetId: text("asset_id").notNull(),
    order: integer("order").default(0), // Display order
    createdAt: text("created_at").notNull(),
});

// Asset tags table - for better tag management
export const assetTags = sqliteTable("asset_tags", {
    id: text("id").primaryKey(),
    name: text("name").notNull().unique(),
    userId: text("user_id").notNull(),
    createdAt: text("created_at").notNull(),
});

// Asset tag relationships table - many-to-many relationship
export const assetTagRelations = sqliteTable("asset_tag_relations", {
    id: text("id").primaryKey(),
    assetId: text("asset_id").notNull(),
    tagId: text("tag_id").notNull(),
    createdAt: text("created_at").notNull(),
});
