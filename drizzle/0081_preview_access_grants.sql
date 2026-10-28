CREATE TABLE `storefront_preview_access_exchanges` (
	`id` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`binder_hash` text NOT NULL,
	`kind` text NOT NULL,
	`session_id` text NOT NULL,
	`user_id` text NOT NULL,
	`storefront_id` text NOT NULL,
	`theme_id` text NOT NULL,
	`preview_id` text NOT NULL,
	`preview_host` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`storefront_id`) REFERENCES `storefronts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`theme_id`) REFERENCES `storefront_themes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `storefront_preview_access_exchanges_code_idx` ON `storefront_preview_access_exchanges` (`code_hash`);--> statement-breakpoint
CREATE TABLE `storefront_preview_access_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`kind` text NOT NULL,
	`session_id` text NOT NULL,
	`user_id` text NOT NULL,
	`storefront_id` text NOT NULL,
	`theme_id` text NOT NULL,
	`preview_id` text NOT NULL,
	`preview_host` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`storefront_id`) REFERENCES `storefronts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`theme_id`) REFERENCES `storefront_themes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `storefront_preview_access_grants_token_idx` ON `storefront_preview_access_grants` (`token_hash`);--> statement-breakpoint
CREATE INDEX `storefront_preview_access_grants_session_idx` ON `storefront_preview_access_grants` (`session_id`);--> statement-breakpoint
CREATE INDEX `storefront_preview_access_grants_user_idx` ON `storefront_preview_access_grants` (`user_id`);