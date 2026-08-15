CREATE TABLE `storefront_theme_template_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`version` integer NOT NULL,
	`document` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`published_at` text,
	FOREIGN KEY (`template_id`) REFERENCES `storefront_theme_templates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `storefront_theme_template_revisions_version_unique` ON `storefront_theme_template_revisions` (`template_id`,`version`);--> statement-breakpoint
CREATE INDEX `storefront_theme_template_revisions_created_idx` ON `storefront_theme_template_revisions` (`template_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `storefront_theme_templates` ADD `draft_revision_id` text;--> statement-breakpoint
ALTER TABLE `storefront_theme_templates` ADD `published_revision_id` text;