CREATE TABLE `storefront_comment_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`storefront_id` text NOT NULL,
	`theme_id` text NOT NULL,
	`template_id` text NOT NULL,
	`section_id` text,
	`element_key` text,
	`position_x` real DEFAULT 50 NOT NULL,
	`position_y` real DEFAULT 50 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`resolved_at` text,
	`resolved_by` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`storefront_id`) REFERENCES `storefronts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`theme_id`) REFERENCES `storefront_themes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`template_id`) REFERENCES `storefront_theme_templates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `storefront_comment_threads_template_status_idx` ON `storefront_comment_threads` (`template_id`,`status`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `storefront_comment_threads_created_by_idx` ON `storefront_comment_threads` (`created_by`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `storefront_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`created_by` text NOT NULL,
	`content` text NOT NULL,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`thread_id`) REFERENCES `storefront_comment_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `storefront_comments_thread_created_idx` ON `storefront_comments` (`thread_id`,`created_at`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `storefront_comments_created_by_idx` ON `storefront_comments` (`created_by`,`deleted_at`);