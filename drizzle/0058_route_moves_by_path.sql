-- Route moves are recorded by path, whether or not the route has a document
-- yet: a route's document is created by its first content write, which may
-- come after the route moved, and a rollback still has to carry it back.
-- SQLite cannot drop a column that is a foreign key, so the table is rebuilt.
CREATE TABLE `__new_storefront_theme_route_document_moves` (
	`id` text PRIMARY KEY NOT NULL,
	`theme_id` text NOT NULL,
	`from_route_path` text NOT NULL,
	`to_route_path` text NOT NULL,
	`source_generation` integer NOT NULL,
	`sequence` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`theme_id`) REFERENCES `storefront_themes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_storefront_theme_route_document_moves` (`id`, `theme_id`, `from_route_path`, `to_route_path`, `source_generation`, `sequence`, `created_at`)
SELECT `id`, `theme_id`, `from_route_path`, `to_route_path`, `source_generation`, `sequence`, `created_at` FROM `storefront_theme_route_document_moves`;
--> statement-breakpoint
DROP TABLE `storefront_theme_route_document_moves`;
--> statement-breakpoint
ALTER TABLE `__new_storefront_theme_route_document_moves` RENAME TO `storefront_theme_route_document_moves`;
--> statement-breakpoint
CREATE INDEX `storefront_theme_route_document_moves_theme_generation_idx` ON `storefront_theme_route_document_moves` (`theme_id`,`source_generation`);
