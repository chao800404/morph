-- History of route-owned documents following their route source to a new
-- path, so a source rollback can carry each document back with its route.
CREATE TABLE `storefront_theme_route_document_moves` (
	`id` text PRIMARY KEY NOT NULL,
	`theme_id` text NOT NULL,
	`template_id` text NOT NULL,
	`from_route_path` text NOT NULL,
	`to_route_path` text NOT NULL,
	`source_generation` integer NOT NULL,
	`sequence` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`theme_id`) REFERENCES `storefront_themes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`template_id`) REFERENCES `storefront_theme_templates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `storefront_theme_route_document_moves_theme_generation_idx` ON `storefront_theme_route_document_moves` (`theme_id`,`source_generation`);
