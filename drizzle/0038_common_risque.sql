CREATE TABLE `storefront_theme_files` (
	`id` text PRIMARY KEY NOT NULL,
	`storefront_id` text NOT NULL,
	`theme_id` text NOT NULL,
	`path` text NOT NULL,
	`content` text NOT NULL,
	`mime_type` text DEFAULT 'text/plain',
	`is_entry` integer DEFAULT false,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`storefront_id`) REFERENCES `storefronts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`theme_id`) REFERENCES `storefront_themes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `storefront_theme_files_theme_path_unique` ON `storefront_theme_files` (`theme_id`,`path`) WHERE "storefront_theme_files"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `storefront_theme_files_theme_idx` ON `storefront_theme_files` (`theme_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `storefront_theme_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`storefront_id` text NOT NULL,
	`theme_id` text NOT NULL,
	`revision_number` integer NOT NULL,
	`message` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`snapshot` text NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`storefront_id`) REFERENCES `storefronts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`theme_id`) REFERENCES `storefront_themes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `storefront_theme_revisions_theme_rev_unique` ON `storefront_theme_revisions` (`theme_id`,`revision_number`);--> statement-breakpoint
CREATE INDEX `storefront_theme_revisions_theme_idx` ON `storefront_theme_revisions` (`theme_id`,`deleted_at`);