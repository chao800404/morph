CREATE TABLE `storefront_theme_builds` (
	`id` text PRIMARY KEY NOT NULL,
	`storefront_id` text NOT NULL,
	`theme_id` text NOT NULL,
	`source_revision_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`input_hash` text,
	`compiler_id` text,
	`compiler_version` text,
	`artifact_prefix` text,
	`manifest_json` text,
	`diagnostics_json` text,
	`error_message` text,
	`started_at` text,
	`completed_at` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`storefront_id`) REFERENCES `storefronts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`theme_id`) REFERENCES `storefront_themes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_revision_id`) REFERENCES `storefront_theme_revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `storefront_theme_builds_theme_idx` ON `storefront_theme_builds` (`theme_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `storefront_theme_builds_revision_idx` ON `storefront_theme_builds` (`source_revision_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `storefront_theme_builds_status_idx` ON `storefront_theme_builds` (`status`,`deleted_at`);