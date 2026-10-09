CREATE TABLE `storefront_theme_preview_content_tickets` (
	`preview_id` text PRIMARY KEY NOT NULL,
	`storefront_id` text NOT NULL,
	`theme_id` text NOT NULL,
	`ticket` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`storefront_id`) REFERENCES `storefronts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`theme_id`) REFERENCES `storefront_themes`(`id`) ON UPDATE no action ON DELETE cascade
);
