CREATE TABLE `storefront_theme_dependencies` (
	`id` text PRIMARY KEY NOT NULL,
	`storefront_id` text NOT NULL,
	`theme_id` text NOT NULL,
	`package_name` text NOT NULL,
	`package_version` text NOT NULL,
	`status` text DEFAULT 'requested' NOT NULL,
	`build_id` text,
	`requested_by` text,
	`error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`storefront_id`) REFERENCES `storefronts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`theme_id`) REFERENCES `storefront_themes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`build_id`) REFERENCES `storefront_theme_builds`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `storefront_theme_dependencies_theme_package_unique` ON `storefront_theme_dependencies` (`theme_id`,`package_name`) WHERE "storefront_theme_dependencies"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `storefront_theme_dependencies_theme_status_idx` ON `storefront_theme_dependencies` (`theme_id`,`status`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `storefront_theme_dependencies_build_idx` ON `storefront_theme_dependencies` (`build_id`,`deleted_at`);--> statement-breakpoint
ALTER TABLE `storefront_theme_builds` ADD `dependencies_json` text;