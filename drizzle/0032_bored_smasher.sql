CREATE TABLE `storefront_page_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`version` integer NOT NULL,
	`document` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`published_at` text,
	FOREIGN KEY (`page_id`) REFERENCES `storefront_pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `storefront_page_revisions_page_version_unique` ON `storefront_page_revisions` (`page_id`,`version`);--> statement-breakpoint
CREATE INDEX `storefront_page_revisions_page_created_idx` ON `storefront_page_revisions` (`page_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `storefront_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`storefront_id` text NOT NULL,
	`title` text NOT NULL,
	`handle` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`draft_revision_id` text,
	`published_revision_id` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`storefront_id`) REFERENCES `storefronts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `storefront_pages_active_handle_unique` ON `storefront_pages` (`storefront_id`,`handle`) WHERE "storefront_pages"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `storefront_pages_storefront_status_idx` ON `storefront_pages` (`storefront_id`,`status`,`deleted_at`);