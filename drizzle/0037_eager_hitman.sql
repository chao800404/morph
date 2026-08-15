CREATE TABLE `storefront_comment_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`storefront_id` text NOT NULL,
	`theme_id` text NOT NULL,
	`template_id` text NOT NULL,
	`name` text NOT NULL,
	`viewport_width` integer DEFAULT 1440 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`storefront_id`) REFERENCES `storefronts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`theme_id`) REFERENCES `storefront_themes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`template_id`) REFERENCES `storefront_theme_templates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `storefront_comment_groups_template_idx` ON `storefront_comment_groups` (`template_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `storefront_comment_groups_created_by_idx` ON `storefront_comment_groups` (`created_by`,`deleted_at`);--> statement-breakpoint
ALTER TABLE `storefront_comment_threads` ADD `group_id` text REFERENCES storefront_comment_groups(id);--> statement-breakpoint
CREATE INDEX `storefront_comment_threads_group_idx` ON `storefront_comment_threads` (`group_id`,`deleted_at`);