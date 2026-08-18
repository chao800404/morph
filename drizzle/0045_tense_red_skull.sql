CREATE TABLE `storefront_releases` (
	`id` text PRIMARY KEY NOT NULL,
	`storefront_id` text NOT NULL,
	`theme_id` text NOT NULL,
	`source_revision_id` text NOT NULL,
	`theme_build_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`metadata` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`storefront_id`) REFERENCES `storefronts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`theme_id`) REFERENCES `storefront_themes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_revision_id`) REFERENCES `storefront_theme_revisions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`theme_build_id`) REFERENCES `storefront_theme_builds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `storefront_releases_storefront_status_idx` ON `storefront_releases` (`storefront_id`,`status`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `storefront_releases_theme_idx` ON `storefront_releases` (`theme_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `storefront_releases_source_revision_idx` ON `storefront_releases` (`source_revision_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `storefront_releases_theme_build_idx` ON `storefront_releases` (`theme_build_id`,`deleted_at`);--> statement-breakpoint
ALTER TABLE `storefronts` ADD `active_release_id` text;