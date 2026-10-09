CREATE TABLE `storefront_theme_sync_capabilities` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`storefront_id` text NOT NULL,
	`theme_id` text NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`storefront_id`) REFERENCES `storefronts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`theme_id`) REFERENCES `storefront_themes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `storefront_theme_sync_capabilities_token_idx` ON `storefront_theme_sync_capabilities` (`token_hash`);--> statement-breakpoint
CREATE INDEX `storefront_theme_sync_capabilities_theme_user_idx` ON `storefront_theme_sync_capabilities` (`theme_id`,`user_id`);