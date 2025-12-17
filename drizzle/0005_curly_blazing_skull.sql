CREATE TABLE `asset_collection_items` (
	`id` text PRIMARY KEY NOT NULL,
	`collection_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`order` integer DEFAULT 0,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `asset_collections` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `asset_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`id_path` text NOT NULL,
	`parent_id` text,
	`path` text NOT NULL,
	`child_count` integer DEFAULT 0 NOT NULL,
	`asset_count` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `asset_tag_relations` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `asset_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `asset_tags_name_unique` ON `asset_tags` (`name`);--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`folder_id` text,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`original_name` text NOT NULL,
	`alt` text,
	`caption` text,
	`tags` text,
	`mime_type` text,
	`size` integer NOT NULL,
	`size_formatted` text NOT NULL,
	`url` text NOT NULL,
	`width` integer,
	`height` integer,
	`duration` integer,
	`thumbnail_url` text,
	`metadata` text,
	`custom_metadata` text,
	`uploaded_by` text NOT NULL,
	`updated_by` text DEFAULT 'system' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
DROP INDEX `accounts_userId_idx`;--> statement-breakpoint
DROP INDEX `sessions_userId_idx`;--> statement-breakpoint
ALTER TABLE `sessions` ADD `impersonated_by` text;--> statement-breakpoint
DROP INDEX `verifications_identifier_idx`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`is_anonymous` integer,
	`role` text,
	`banned` integer DEFAULT false,
	`ban_reason` text,
	`ban_expires` integer,
	`language` text
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "name", "email", "email_verified", "image", "created_at", "updated_at", "is_anonymous", "role", "banned", "ban_reason", "ban_expires", "language") SELECT "id", "name", "email", "email_verified", "image", "created_at", "updated_at", "is_anonymous", "role", "banned", "ban_reason", "ban_expires", "language" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);