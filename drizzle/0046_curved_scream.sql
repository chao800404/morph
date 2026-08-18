CREATE TABLE `storefront_content_publication_items` (
	`id` text PRIMARY KEY NOT NULL,
	`publication_id` text NOT NULL,
	`item_type` text NOT NULL,
	`content_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`publication_id`) REFERENCES `storefront_content_publications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `storefront_content_publication_items_unique` ON `storefront_content_publication_items` (`publication_id`,`item_type`,`content_id`);--> statement-breakpoint
CREATE INDEX `storefront_content_publication_items_revision_idx` ON `storefront_content_publication_items` (`revision_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `storefront_content_publications` (
	`id` text PRIMARY KEY NOT NULL,
	`storefront_id` text NOT NULL,
	`created_by` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`storefront_id`) REFERENCES `storefronts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `storefront_content_publications_storefront_idx` ON `storefront_content_publications` (`storefront_id`,`deleted_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_storefront_releases` (
	`id` text PRIMARY KEY NOT NULL,
	`storefront_id` text NOT NULL,
	`theme_id` text NOT NULL,
	`source_revision_id` text NOT NULL,
	`theme_build_id` text NOT NULL,
	`content_publication_id` text,
	`status` text DEFAULT 'available' NOT NULL,
	`metadata` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`storefront_id`) REFERENCES `storefronts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`theme_id`) REFERENCES `storefront_themes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_revision_id`) REFERENCES `storefront_theme_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`theme_build_id`) REFERENCES `storefront_theme_builds`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_storefront_releases`("id", "storefront_id", "theme_id", "source_revision_id", "theme_build_id", "content_publication_id", "status", "metadata", "created_by", "created_at", "updated_at", "deleted_at") SELECT "id", "storefront_id", "theme_id", "source_revision_id", "theme_build_id", "content_publication_id", "status", "metadata", "created_by", "created_at", "updated_at", "deleted_at" FROM `storefront_releases`;--> statement-breakpoint
DROP TABLE `storefront_releases`;--> statement-breakpoint
ALTER TABLE `__new_storefront_releases` RENAME TO `storefront_releases`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `storefront_releases_storefront_status_idx` ON `storefront_releases` (`storefront_id`,`status`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `storefront_releases_theme_idx` ON `storefront_releases` (`theme_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `storefront_releases_source_revision_idx` ON `storefront_releases` (`source_revision_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `storefront_releases_theme_build_idx` ON `storefront_releases` (`theme_build_id`,`deleted_at`);--> statement-breakpoint
ALTER TABLE `storefront_theme_revisions` ADD `source_generation` integer;
UPDATE `storefront_releases` SET `status` = 'available' WHERE `status` IN ('active', 'superseded');
