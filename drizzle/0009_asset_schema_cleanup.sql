CREATE TABLE `__asset_cleanup_guard` (
	`row_count` integer NOT NULL CHECK (`row_count` = 0)
);
--> statement-breakpoint
INSERT INTO `__asset_cleanup_guard` (`row_count`)
SELECT
	(SELECT COUNT(*) FROM `asset_collection_items`) +
	(SELECT COUNT(*) FROM `asset_collections`) +
	(SELECT COUNT(*) FROM `asset_tag_relations`) +
	(SELECT COUNT(*) FROM `asset_tags`);
--> statement-breakpoint
DROP TABLE `__asset_cleanup_guard`;--> statement-breakpoint
DROP TABLE `asset_collection_items`;--> statement-breakpoint
DROP TABLE `asset_collections`;--> statement-breakpoint
DROP TABLE `asset_tag_relations`;--> statement-breakpoint
DROP TABLE `asset_tags`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`folder_id` text,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`original_name` text NOT NULL,
	`alt` text,
	`caption` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`mime_type` text,
	`size` integer NOT NULL,
	`url` text NOT NULL,
	`width` integer,
	`height` integer,
	`duration` integer,
	`thumbnail_url` text,
	`metadata` text NOT NULL,
	`uploaded_by` text NOT NULL,
	`updated_by` text DEFAULT 'system' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`folder_id`) REFERENCES `asset_folders`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "assets_type_check" CHECK("__new_assets"."type" IN ('image', 'video', 'rive', 'model')),
	CONSTRAINT "assets_size_check" CHECK("__new_assets"."size" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_assets`("id", "folder_id", "type", "name", "original_name", "alt", "caption", "tags", "mime_type", "size", "url", "width", "height", "duration", "thumbnail_url", "metadata", "uploaded_by", "updated_by", "created_at", "updated_at", "deleted_at")
SELECT
	"id",
	CASE
		WHEN "folder_id" IS NULL OR EXISTS (
			SELECT 1 FROM `asset_folders`
			WHERE `asset_folders`.`id` = `assets`.`folder_id`
		) THEN "folder_id"
		ELSE NULL
	END,
	"type",
	"name",
	"original_name",
	"alt",
	"caption",
	CASE
		WHEN "tags" IS NULL OR trim("tags") = '' THEN '[]'
		WHEN json_valid("tags") AND json_type("tags") = 'array' THEN "tags"
		ELSE json_array("tags")
	END,
	"mime_type",
	"size",
	"url",
	"width",
	"height",
	"duration",
	"thumbnail_url",
	json_object(
		'version',
		1,
		'r2Key',
		COALESCE(
			CASE
				WHEN json_valid("metadata") THEN json_extract("metadata", '$.r2Key')
				ELSE NULL
			END,
			ltrim("url", '/')
		)
	),
	"uploaded_by",
	"updated_by",
	"created_at",
	"updated_at",
	"deleted_at"
FROM `assets`;--> statement-breakpoint
DROP TABLE `assets`;--> statement-breakpoint
ALTER TABLE `__new_assets` RENAME TO `assets`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `assets_folder_active_idx` ON `assets` (`folder_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `assets_type_active_idx` ON `assets` (`type`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `assets_uploaded_by_idx` ON `assets` (`uploaded_by`);--> statement-breakpoint
CREATE UNIQUE INDEX `assets_url_unique` ON `assets` (`url`);--> statement-breakpoint
CREATE TABLE `__new_asset_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`id_path` text NOT NULL,
	`parent_id` text,
	`path` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`parent_id`) REFERENCES `asset_folders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_asset_folders`("id", "name", "description", "id_path", "parent_id", "path", "created_by", "updated_by", "created_at", "updated_at", "deleted_at")
SELECT
	"id",
	"name",
	"description",
	"id_path",
	CASE
		WHEN "parent_id" IS NULL OR EXISTS (
			SELECT 1 FROM `asset_folders` AS `parent_folder`
			WHERE `parent_folder`.`id` = `asset_folders`.`parent_id`
		) THEN "parent_id"
		ELSE NULL
	END,
	"path",
	"created_by",
	"updated_by",
	"created_at",
	"updated_at",
	"deleted_at"
FROM `asset_folders`;--> statement-breakpoint
DROP TABLE `asset_folders`;--> statement-breakpoint
ALTER TABLE `__new_asset_folders` RENAME TO `asset_folders`;--> statement-breakpoint
CREATE INDEX `asset_folders_parent_active_idx` ON `asset_folders` (`parent_id`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `asset_folders_id_path_unique` ON `asset_folders` (`id_path`);--> statement-breakpoint
CREATE UNIQUE INDEX `asset_folders_active_path_unique` ON `asset_folders` (`path`) WHERE "asset_folders"."deleted_at" IS NULL;
