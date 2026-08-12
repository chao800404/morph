CREATE TABLE `user_table_views` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`table_key` text NOT NULL,
	`name` text DEFAULT 'Default' NOT NULL,
	`configuration` text NOT NULL,
	`is_default` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_table_views_user_table_name_uq` ON `user_table_views` (`user_id`,`table_key`,`name`);