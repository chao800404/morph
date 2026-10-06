CREATE TABLE `storefront_build_preview_capabilities` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`storefront_id` text NOT NULL,
	`theme_id` text NOT NULL,
	`build_id` text NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`storefront_id`) REFERENCES `storefronts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`theme_id`) REFERENCES `storefront_themes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`build_id`) REFERENCES `storefront_theme_builds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `storefront_build_preview_capabilities_token_idx` ON `storefront_build_preview_capabilities` (`token_hash`);--> statement-breakpoint
CREATE INDEX `storefront_build_preview_capabilities_build_user_idx` ON `storefront_build_preview_capabilities` (`build_id`,`user_id`);